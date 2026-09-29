import { EventRole, SubmissionStatus } from "@prisma/client";
import {
  planAssignments,
  type AssignableJudge,
  type AssignableSubmission,
} from "../algorithms/judge-assignment.js";
import {
  ScoreValidationError,
  validateBallot,
  weightedTotal,
  type Criterion,
} from "../algorithms/scoring.js";
import { panelIntegrity } from "../algorithms/integrity.js";
import { prisma } from "../db.js";
import { badRequest, forbidden, notFound, unprocessable } from "../lib/errors.js";
import type { AuthUser } from "../middleware/auth.js";
import { AuditAction, recordAudit } from "./audit.service.js";
import type { EventContext } from "./authorization.service.js";
import { lockRubricIfNeeded, requireRubric } from "./rubric.service.js";

/** Enforced server-side. Publishing results closes it, so ballots cannot drift from published standings. */
export function judgingWindow(
  event: { judgingOpensAt: Date | null; judgingClosesAt: Date | null; resultsPublished?: boolean },
  now = new Date(),
): { open: boolean; reason?: string } {
  if (event.resultsPublished) {
    return { open: false, reason: "Results are published, so ballots are frozen." };
  }
  if (event.judgingOpensAt && now < event.judgingOpensAt) {
    return { open: false, reason: "Judging has not opened yet." };
  }
  if (event.judgingClosesAt && now > event.judgingClosesAt) {
    return { open: false, reason: "The judging window has closed." };
  }
  return { open: true };
}

export function assertJudgingOpen(ctx: EventContext): void {
  const window = judgingWindow(ctx.event);
  if (!window.open) throw forbidden(window.reason ?? "Judging is closed.");
}

// ----------------------------------------------------------------
// Assignment (organizer only)
// ----------------------------------------------------------------

export interface GeneratePlanOptions {
  maxPerJudge?: number;
  seed?: number;
  dryRun?: boolean;
}

export async function generateAssignments(
  ctx: EventContext,
  options: GeneratePlanOptions = {},
  ipHash?: string,
) {
  const [submissions, judges] = await Promise.all([
    prisma.submission.findMany({
      where: { eventId: ctx.event.id, status: SubmissionStatus.SUBMITTED },
      select: {
        id: true,
        trackId: true,
        team: { select: { members: { select: { userId: true } } } },
      },
    }),
    prisma.eventMembership.findMany({
      where: { eventId: ctx.event.id, role: EventRole.JUDGE },
      select: { userId: true },
    }),
  ]);

  if (judges.length === 0) throw badRequest("Invite at least one judge before assigning.");

  const existing = await prisma.judgeAssignment.findMany({
    where: { eventId: ctx.event.id },
    select: { judgeId: true, submissionId: true },
  });

  const assignable: AssignableSubmission[] = submissions.map((s) => ({
    id: s.id,
    memberIds: s.team.members.map((m) => m.userId),
  }));

  const assignableJudges: AssignableJudge[] = judges.map((j) => ({
    id: j.userId,
    existingSubmissionIds: existing
      .filter((e) => e.judgeId === j.userId)
      .map((e) => e.submissionId),
  }));

  const plan = planAssignments(assignable, assignableJudges, {
    reviewsPerSubmission: ctx.event.reviewsPerSubmission,
    maxPerJudge: options.maxPerJudge,
    seed: options.seed,
  });

  if (options.dryRun) return { ...plan, applied: 0 };

  if (plan.assignments.length > 0) {
    await prisma.judgeAssignment.createMany({
      data: plan.assignments.map((a) => ({
        eventId: ctx.event.id,
        judgeId: a.judgeId,
        submissionId: a.submissionId,
        position: a.position,
      })),
      skipDuplicates: true,
    });
  }

  await recordAudit({
    action: AuditAction.JUDGE_ASSIGNED,
    eventId: ctx.event.id,
    actorId: ctx.user?.id ?? null,
    targetType: "event",
    targetId: ctx.event.id,
    summary: `${plan.assignments.length} judge assignments generated across ${judges.length} judges`,
    metadata: {
      created: plan.assignments.length,
      shortfalls: plan.shortfalls.length,
      seed: options.seed ?? 42,
    },
    ipHash,
  });

  return { ...plan, applied: plan.assignments.length };
}

export async function assignJudgeManually(
  ctx: EventContext,
  judgeId: string,
  submissionId: string,
  ipHash?: string,
) {
  const membership = await prisma.eventMembership.findUnique({
    where: {
      eventId_userId_role: { eventId: ctx.event.id, userId: judgeId, role: EventRole.JUDGE },
    },
  });
  if (!membership) throw badRequest("That account is not a judge on this event.");

  const submission = await prisma.submission.findFirst({
    where: { id: submissionId, eventId: ctx.event.id },
    select: { id: true, trackId: true, team: { select: { members: { select: { userId: true } } } } },
  });
  if (!submission) throw notFound("Submission not found.");

  if (submission.team.members.some((m) => m.userId === judgeId)) {
    throw badRequest("A judge cannot be assigned their own team's submission.");
  }

  const count = await prisma.judgeAssignment.count({
    where: { eventId: ctx.event.id, judgeId },
  });

  const assignment = await prisma.judgeAssignment.create({
    data: { eventId: ctx.event.id, judgeId, submissionId, position: count },
  });

  await recordAudit({
    action: AuditAction.JUDGE_ASSIGNED,
    eventId: ctx.event.id,
    actorId: ctx.user?.id ?? null,
    targetType: "judge_assignment",
    targetId: assignment.id,
    summary: "A judge was assigned a submission manually",
    metadata: { judgeId, submissionId },
    ipHash,
  });

  return assignment;
}

export async function unassignJudge(ctx: EventContext, assignmentId: string, ipHash?: string) {
  const assignment = await prisma.judgeAssignment.findFirst({
    where: { id: assignmentId, eventId: ctx.event.id },
  });
  if (!assignment) throw notFound("Assignment not found.");

  const scored = await prisma.judgeScore.findUnique({
    where: {
      judgeId_submissionId: {
        judgeId: assignment.judgeId,
        submissionId: assignment.submissionId,
      },
    },
    select: { id: true },
  });
  if (scored) throw badRequest("That assignment has already been scored and cannot be removed.");

  await prisma.judgeAssignment.delete({ where: { id: assignment.id } });

  await recordAudit({
    action: AuditAction.JUDGE_UNASSIGNED,
    eventId: ctx.event.id,
    actorId: ctx.user?.id ?? null,
    targetType: "judge_assignment",
    targetId: assignment.id,
    summary: "A judge assignment was removed",
    metadata: { judgeId: assignment.judgeId, submissionId: assignment.submissionId },
    ipHash,
  });
}

// ----------------------------------------------------------------
// Judge console. Everything below is scoped to the calling judge.
// ----------------------------------------------------------------

/**
 * The judge's own queue. The judge id comes from the session, never from the
 * request, so there is no parameter to tamper with.
 */
export async function getMyQueue(ctx: EventContext, judge: AuthUser) {
  const assignments = await prisma.judgeAssignment.findMany({
    where: { eventId: ctx.event.id, judgeId: judge.id, submission: { status: { not: SubmissionStatus.DISQUALIFIED } } },
    orderBy: { position: "asc" },
    include: {
      submission: {
        select: {
          id: true,
          name: true,
          tagline: true,
          description: true,
          thumbnailUrl: true,
          repoUrl: true,
          liveUrl: true,
          videoUrl: true,
          techTags: true,
          trackId: true,
          track: { select: { id: true, name: true, slug: true } },
          images: { orderBy: { position: "asc" } },
          answers: { include: { question: true } },
        },
      },
    },
  });

  const myScores = await prisma.judgeScore.findMany({
    where: { eventId: ctx.event.id, judgeId: judge.id },
    include: { criterionScores: true },
  });
  const scoreBySubmission = new Map(myScores.map((s) => [s.submissionId, s]));

  return {
    window: judgingWindow(ctx.event),
    total: assignments.length,
    completed: assignments.filter((a) => scoreBySubmission.has(a.submissionId)).length,
    items: assignments.map((a) => {
      const score = scoreBySubmission.get(a.submissionId);
      return {
        assignmentId: a.id,
        position: a.position,
        skippedAt: a.skippedAt,
        submission: a.submission,
        // Only ever this judge's own ballot.
        myScore: score
          ? {
              weightedTotal: score.weightedTotal,
              comment: score.comment,
              submittedAt: score.submittedAt,
              criteria: score.criterionScores.map((c) => ({
                criterionId: c.criterionId,
                value: c.value,
              })),
            }
          : null,
      };
    }),
  };
}

/** Throws unless this judge is actually assigned this submission. */
async function requireOwnAssignment(ctx: EventContext, judgeId: string, submissionId: string) {
  const assignment = await prisma.judgeAssignment.findUnique({
    where: { judgeId_submissionId: { judgeId, submissionId } },
    include: { submission: { select: { id: true, trackId: true, eventId: true, status: true } } },
  });

  if (!assignment || assignment.eventId !== ctx.event.id) {
    throw forbidden("You are not assigned to this submission.");
  }
  if (assignment.submission.status === SubmissionStatus.DISQUALIFIED) {
    throw forbidden("The organizers removed this project from judging.");
  }
  return assignment;
}

export interface BallotInput {
  criteria: Array<{ criterionId: string; value: number }>;
  comment?: string | null;
}

export async function submitScore(
  ctx: EventContext,
  judge: AuthUser,
  submissionId: string,
  input: BallotInput,
  ipHash?: string,
) {
  assertJudgingOpen(ctx);
  await requireOwnAssignment(ctx, judge.id, submissionId);

  const rubric = await requireRubric(ctx.event.id);
  const criteria: Criterion[] = rubric.criteria.map((c) => ({
    id: c.id,
    key: c.key,
    weight: c.weight,
    minScore: c.minScore,
    maxScore: c.maxScore,
  }));

  try {
    validateBallot(criteria, input.criteria);
  } catch (err) {
    if (err instanceof ScoreValidationError) {
      throw unprocessable("This ballot is not valid.", err.fields);
    }
    throw err;
  }

  // Computed here, from the stored rubric. A total in the request body is ignored.
  const total = weightedTotal(criteria, input.criteria);

  const keyByCriterion = new Map(criteria.map((c) => [c.id, c.key]));
  const byKey = (rows: Array<{ criterionId: string; value: number }>) =>
    Object.fromEntries(rows.map((r) => [keyByCriterion.get(r.criterionId) ?? r.criterionId, r.value]));

  // Upsert, so two racing first submissions resolve to one ballot; `before` feeds the audit diff.
  const { score, previous } = await prisma.$transaction(async (tx) => {
    const before = await tx.judgeScore.findUnique({
      where: { judgeId_submissionId: { judgeId: judge.id, submissionId } },
      select: { weightedTotal: true, comment: true, criterionScores: { select: { criterionId: true, value: true } } },
    });

    const row = await tx.judgeScore.upsert({
      where: { judgeId_submissionId: { judgeId: judge.id, submissionId } },
      create: {
        eventId: ctx.event.id,
        judgeId: judge.id,
        submissionId,
        weightedTotal: total,
        comment: input.comment ?? null,
      },
      update: { weightedTotal: total, comment: input.comment ?? null },
    });

    await tx.criterionScore.deleteMany({ where: { scoreId: row.id } });
    await tx.criterionScore.createMany({
      data: input.criteria.map((c) => ({
        scoreId: row.id,
        criterionId: c.criterionId,
        value: c.value,
      })),
    });

    const saved = await tx.judgeScore.findUniqueOrThrow({
      where: { id: row.id },
      include: { criterionScores: true },
    });
    return { score: saved, previous: before };
  });

  await lockRubricIfNeeded(ctx.event.id);

  const after = { weightedTotal: total, criteria: byKey(input.criteria), comment: input.comment ?? null };
  await recordAudit({
    action: previous ? AuditAction.SCORE_UPDATED : AuditAction.SCORE_SUBMITTED,
    eventId: ctx.event.id,
    actorId: judge.id,
    targetType: "judge_score",
    targetId: score.id,
    summary: previous
      ? `${judge.name} changed a ballot from ${previous.weightedTotal} to ${total}`
      : `${judge.name} submitted a ballot (${total})`,
    metadata: previous
      ? {
          submissionId,
          weightedTotal: total,
          before: {
            weightedTotal: previous.weightedTotal,
            criteria: byKey(previous.criterionScores),
            comment: previous.comment,
          },
          after,
        }
      : { submissionId, weightedTotal: total, after },
    ipHash,
  });

  return score;
}

export async function skipAssignment(
  ctx: EventContext,
  judge: AuthUser,
  submissionId: string,
  reason: string | null,
  ipHash?: string,
) {
  assertJudgingOpen(ctx);
  const assignment = await requireOwnAssignment(ctx, judge.id, submissionId);

  const skipped = await prisma.judgeAssignment.update({
    where: { id: assignment.id },
    data: { skippedAt: new Date(), skipReason: reason },
  });
  await recordAudit({
    action: AuditAction.ASSIGNMENT_SKIPPED,
    eventId: ctx.event.id,
    actorId: judge.id,
    targetType: "submission",
    targetId: submissionId,
    summary: `${judge.name} skipped an assigned submission`,
    metadata: reason ? { reason } : {},
    ipHash,
  });
  return skipped;
}

/** A judge may read one of their own ballots back. Never anyone else's. */
export async function getMyScore(ctx: EventContext, judge: AuthUser, submissionId: string) {
  await requireOwnAssignment(ctx, judge.id, submissionId);

  return prisma.judgeScore.findUnique({
    where: { judgeId_submissionId: { judgeId: judge.id, submissionId } },
    include: { criterionScores: true },
  });
}

/**
 * One judge's ballots in this event. `judgeId` is taken from the URL, so it is never trusted:
 * a judge may read only their own ballots, an organizer or event admin may read any judge's,
 * and every other caller is refused with 403. A refused read of a peer is written to the
 * audit log, because it is exactly the probe this boundary exists to stop.
 */
export async function getJudgeScores(ctx: EventContext, caller: AuthUser, judgeId: string, ipHash?: string) {
  const targetId = judgeId === "me" ? caller.id : judgeId;

  if (targetId !== caller.id && !ctx.permissions.has("JUDGING")) {
    await recordAudit({
      action: AuditAction.ACCESS_DENIED,
      eventId: ctx.event.id,
      actorId: caller.id,
      targetType: "judge",
      targetId,
      summary: `${caller.name} was refused another judge's scores`,
      ipHash,
    });
    throw forbidden("A judge can read only their own scores.");
  }
  if (targetId === caller.id && !ctx.isJudge) throw forbidden("You are not a judge on this event.");

  const ballots = await prisma.judgeScore.findMany({
    where: { eventId: ctx.event.id, judgeId: targetId },
    select: {
      id: true,
      weightedTotal: true,
      comment: true,
      submittedAt: true,
      submission: { select: { id: true, name: true } },
      criterionScores: { select: { value: true, criterion: { select: { key: true } } } },
    },
    orderBy: { submittedAt: "asc" },
  });

  return {
    judgeId: targetId,
    scores: ballots.map((b) => ({
      id: b.id,
      submission: b.submission,
      weightedTotal: b.weightedTotal,
      comment: b.comment,
      submittedAt: b.submittedAt,
      criteria: Object.fromEntries(b.criterionScores.map((c) => [c.criterion.key, c.value])),
    })),
  };
}

// ----------------------------------------------------------------
// Organizer progress dashboard
// ----------------------------------------------------------------

export async function getJudgingProgress(ctx: EventContext) {
  const [judges, assignments, scores, submissions] = await Promise.all([
    prisma.eventMembership.findMany({
      where: { eventId: ctx.event.id, role: EventRole.JUDGE },
      include: { user: { select: { id: true, name: true, email: true, org: true } } },
    }),
    prisma.judgeAssignment.findMany({
      where: { eventId: ctx.event.id },
      select: { judgeId: true, submissionId: true, skippedAt: true },
    }),
    prisma.judgeScore.findMany({
      where: { eventId: ctx.event.id },
      select: { judgeId: true, submissionId: true, weightedTotal: true, submittedAt: true },
    }),
    prisma.submission.findMany({
      where: { eventId: ctx.event.id, status: SubmissionStatus.SUBMITTED },
      select: { id: true, name: true, track: { select: { name: true } } },
    }),
  ]);

  const target = ctx.event.reviewsPerSubmission;

  const byJudge = judges.map((membership) => {
    const assigned = assignments.filter((a) => a.judgeId === membership.userId);
    const done = scores.filter((s) => s.judgeId === membership.userId);
    return {
      judgeId: membership.userId,
      name: membership.user.name,
      email: membership.user.email,
      org: membership.user.org,
      assigned: assigned.length,
      completed: done.length,
      skipped: assigned.filter((a) => a.skippedAt).length,
      started: done.length > 0,
      percent: assigned.length === 0 ? 0 : Math.round((done.length / assigned.length) * 100),
    };
  });

  const bySubmission = submissions.map((submission) => {
    const received = scores.filter((s) => s.submissionId === submission.id).length;
    return {
      submissionId: submission.id,
      name: submission.name,
      track: submission.track?.name ?? null,
      assigned: assignments.filter((a) => a.submissionId === submission.id).length,
      received,
      target,
      complete: received >= target,
    };
  });

  return {
    target,
    judges: byJudge,
    submissions: bySubmission,
    totals: {
      judges: judges.length,
      notStarted: byJudge.filter((j) => !j.started).length,
      assignments: assignments.length,
      ballots: scores.length,
      fullyReviewed: bySubmission.filter((s) => s.complete).length,
      submissions: submissions.length,
    },
  };
}

/**
 * Removes every assignment that has not been scored yet. Scored assignments are
 * kept: deleting them would orphan a cast ballot and silently shrink a
 * project's evidence.
 */
export async function clearUnscoredAssignments(ctx: EventContext, ipHash?: string) {
  const [assignments, scores] = await Promise.all([
    prisma.judgeAssignment.findMany({
      where: { eventId: ctx.event.id },
      select: { id: true, judgeId: true, submissionId: true },
    }),
    prisma.judgeScore.findMany({
      where: { eventId: ctx.event.id },
      select: { judgeId: true, submissionId: true },
    }),
  ]);

  const scored = new Set(scores.map((s) => `${s.judgeId}:${s.submissionId}`));
  const removable = assignments.filter((a) => !scored.has(`${a.judgeId}:${a.submissionId}`));

  if (removable.length > 0) {
    await prisma.judgeAssignment.deleteMany({ where: { id: { in: removable.map((a) => a.id) } } });
  }

  await recordAudit({
    action: AuditAction.JUDGE_UNASSIGNED,
    eventId: ctx.event.id,
    actorId: ctx.user?.id ?? null,
    targetType: "event",
    targetId: ctx.event.id,
    summary: `${removable.length} unscored assignments cleared, ${assignments.length - removable.length} scored kept`,
    ipHash,
  });

  return { removed: removable.length, kept: assignments.length - removable.length };
}

/**
 * Things worth a question before results go out: judge pairs scoring in lockstep, ballots far from
 * the rest of the panel on the same project, flat judges, and judges assigned a team that shares
 * their organization. Nothing here changes a score.
 */
export async function getPanelIntegrity(ctx: EventContext) {
  const [scores, assignments, judges] = await Promise.all([
    prisma.judgeScore.findMany({
      where: { eventId: ctx.event.id },
      select: { judgeId: true, submissionId: true, weightedTotal: true },
    }),
    prisma.judgeAssignment.findMany({
      where: { eventId: ctx.event.id },
      select: {
        judge: { select: { id: true, name: true, org: true } },
        submission: { select: { id: true, name: true, team: { select: { members: { select: { user: { select: { org: true } } } } } } } },
      },
    }),
    prisma.eventMembership.findMany({
      where: { eventId: ctx.event.id, role: EventRole.JUDGE },
      select: { user: { select: { id: true, name: true } } },
    }),
  ]);

  const report = panelIntegrity(
    scores.map((s) => ({ judgeId: s.judgeId, submissionId: s.submissionId, total: s.weightedTotal })),
  );
  const judgeName = new Map(judges.map((j) => [j.user.id, j.user.name]));
  const submissionName = new Map(assignments.map((a) => [a.submission.id, a.submission.name]));
  const orgOf = (org: string | null) => org?.trim().toLowerCase() || null;

  const conflicts = assignments
    .filter((a) => {
      const org = orgOf(a.judge.org);
      return org !== null && a.submission.team.members.some((m) => orgOf(m.user.org) === org);
    })
    .map((a) => ({ judge: a.judge.name, submission: a.submission.name, org: a.judge.org }));

  return {
    lockstep: report.lockstep.map((p) => ({ ...p, judgeA: judgeName.get(p.judgeA) ?? p.judgeA, judgeB: judgeName.get(p.judgeB) ?? p.judgeB })),
    outliers: report.outliers.slice(0, 25).map((o) => ({
      ...o,
      judge: judgeName.get(o.judgeId) ?? o.judgeId,
      submission: submissionName.get(o.submissionId) ?? o.submissionId,
    })),
    flat: report.flat.map((id) => judgeName.get(id) ?? id),
    conflicts,
  };
}
