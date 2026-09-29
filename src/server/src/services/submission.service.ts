import { EventStatus, Prisma, SubmissionStatus } from "@prisma/client";
import { prisma } from "../db.js";
import { badRequest, conflict, forbidden, notFound } from "../lib/errors.js";
import type { AuthUser } from "../middleware/auth.js";
import { AuditAction, recordAudit, recordAuditSafe } from "./audit.service.js";
import type { EventContext } from "./authorization.service.js";

export const submissionInclude = {
  team: {
    select: {
      id: true,
      name: true,
      members: {
        select: { user: { select: { id: true, name: true, avatarHue: true } } },
      },
    },
  },
  track: { select: { id: true, name: true, slug: true } },
  images: { orderBy: { position: "asc" } },
  answers: { include: { question: true } },
} as const;

export interface DeadlineState {
  open: boolean;
  reason?: string;
  deadline: Date | null;
  msRemaining: number | null;
}

/**
 * The single source of truth for whether a submission may still be written.
 * Every mutating path calls this; the client's own countdown is decoration.
 */
export function submissionWindow(
  event: {
    status: EventStatus;
    submissionsOpenAt: Date | null;
    submissionDeadline: Date | null;
  },
  now = new Date(),
): DeadlineState {
  const deadline = event.submissionDeadline;
  const msRemaining = deadline ? deadline.getTime() - now.getTime() : null;

  if (event.status === EventStatus.DRAFT) {
    return { open: false, reason: "This event is not open yet.", deadline, msRemaining };
  }
  if (event.status === EventStatus.ARCHIVED) {
    return { open: false, reason: "This event is archived.", deadline, msRemaining };
  }
  if (event.submissionsOpenAt && now < event.submissionsOpenAt) {
    return { open: false, reason: "Submissions have not opened yet.", deadline, msRemaining };
  }
  if (deadline && now > deadline) {
    return {
      open: false,
      reason: "The submission deadline has passed. Submissions are read-only.",
      deadline,
      msRemaining,
    };
  }
  return { open: true, deadline, msRemaining };
}

function assertWritable(
  ctx: EventContext,
  submission: { lockedAt: Date | null; status?: SubmissionStatus; flagReason?: string | null } | null,
  actorId: string,
): void {
  if (submission?.status === SubmissionStatus.DISQUALIFIED) {
    throw forbidden(`The organizers removed this project from the event: ${submission.flagReason ?? "no reason given"}`);
  }
  if (submission?.lockedAt) {
    recordAuditSafe({
      action: AuditAction.SUBMISSION_EDIT_REJECTED,
      eventId: ctx.event.id,
      actorId,
      targetType: "submission",
      summary: "Edit rejected: the submission is locked",
    });
    throw forbidden("This submission has been locked by the organizers.");
  }

  const window = submissionWindow(ctx.event);
  if (!window.open) {
    recordAuditSafe({
      action: AuditAction.SUBMISSION_EDIT_REJECTED,
      eventId: ctx.event.id,
      actorId,
      targetType: "submission",
      summary: `Edit rejected: ${window.reason}`,
      metadata: { deadline: window.deadline?.toISOString() ?? null },
    });
    throw forbidden(window.reason ?? "Submissions are closed.");
  }
}

async function loadTeamForUser(eventId: string, userId: string) {
  const team = await prisma.team.findFirst({
    where: { eventId, members: { some: { userId } } },
    select: { id: true, name: true },
  });
  if (!team) throw badRequest("Create or join a team before submitting a project.");
  return team;
}

export interface SubmissionInput {
  name?: string;
  tagline?: string | null;
  description?: string | null;
  thumbnailUrl?: string | null;
  repoUrl?: string | null;
  liveUrl?: string | null;
  videoUrl?: string | null;
  techTags?: string[];
  challengeIds?: string[];
  license?: string | null;
  trackId?: string | null;
  declarations?: Record<string, boolean>;
  answers?: Array<{ questionId: string; value: string }>;
  images?: Array<{ url: string; caption?: string | null }>;
}

async function assertTrackInEvent(eventId: string, trackId?: string | null): Promise<void> {
  if (!trackId) return;
  const track = await prisma.track.findFirst({
    where: { id: trackId, eventId },
    select: { id: true },
  });
  if (!track) throw badRequest("That track does not belong to this event.");
}

async function assertChallengesInEvent(eventId: string, challengeIds?: string[]): Promise<void> {
  if (!challengeIds?.length) return;
  const ids = [...new Set(challengeIds)];
  const count = await prisma.challenge.count({ where: { id: { in: ids }, eventId } });
  if (count !== ids.length) {
    throw badRequest("One or more challenges do not belong to this event.");
  }
}

async function assertQuestionsInEvent(
  eventId: string,
  answers?: Array<{ questionId: string }>,
): Promise<void> {
  if (!answers?.length) return;
  const ids = [...new Set(answers.map((a) => a.questionId))];
  const count = await prisma.customQuestion.count({
    where: { id: { in: ids }, eventId, stage: "SUBMISSION" },
  });
  if (count !== ids.length) {
    throw badRequest("One or more questions do not belong to this event.");
  }
}

export async function createSubmission(
  ctx: EventContext,
  user: AuthUser,
  input: SubmissionInput,
  ipHash?: string,
) {
  if (!ctx.isParticipant) throw forbidden("Register for this event before submitting.");
  assertWritable(ctx, null, user.id);

  const team = await loadTeamForUser(ctx.event.id, user.id);
  const existing = await prisma.submission.findUnique({
    where: { teamId: team.id },
    select: { id: true },
  });
  if (existing) throw conflict("Your team already has a submission.");

  await assertTrackInEvent(ctx.event.id, input.trackId);
  await assertQuestionsInEvent(ctx.event.id, input.answers);
  await assertChallengesInEvent(ctx.event.id, input.challengeIds);

  const submission = await prisma.submission.create({
    data: {
      eventId: ctx.event.id,
      teamId: team.id,
      trackId: input.trackId ?? null,
      name: input.name?.trim() || team.name,
      tagline: input.tagline?.trim() || null,
      description: input.description ?? null,
      thumbnailUrl: input.thumbnailUrl ?? null,
      repoUrl: input.repoUrl ?? null,
      liveUrl: input.liveUrl ?? null,
      videoUrl: input.videoUrl ?? null,
      techTags: input.techTags ?? [],
      challengeIds: input.challengeIds ?? [],
      license: input.license ?? null,
      declarations: (input.declarations ?? {}) as Prisma.InputJsonValue,
      status: SubmissionStatus.DRAFT,
      ...(input.images?.length
        ? {
            images: {
              create: input.images.map((img, i) => ({
                url: img.url,
                caption: img.caption ?? null,
                position: i,
              })),
            },
          }
        : {}),
      ...(input.answers?.length
        ? {
            answers: {
              create: input.answers.map((a) => ({
                questionId: a.questionId,
                value: a.value,
              })),
            },
          }
        : {}),
    },
    include: submissionInclude,
  });

  await recordAudit({
    action: AuditAction.SUBMISSION_CREATED,
    eventId: ctx.event.id,
    actorId: user.id,
    targetType: "submission",
    targetId: submission.id,
    summary: `${user.name} started a submission for team "${team.name}"`,
    ipHash,
  });

  return submission;
}

async function loadOwnSubmission(ctx: EventContext, userId: string) {
  const submission = await prisma.submission.findFirst({
    where: { eventId: ctx.event.id, team: { members: { some: { userId } } } },
    include: submissionInclude,
  });
  if (!submission) throw notFound("You do not have a submission for this event.");
  return submission;
}

export async function getMySubmission(ctx: EventContext, userId: string) {
  return prisma.submission.findFirst({
    where: { eventId: ctx.event.id, team: { members: { some: { userId } } } },
    include: submissionInclude,
  });
}

export async function updateSubmission(
  ctx: EventContext,
  user: AuthUser,
  input: SubmissionInput,
  ipHash?: string,
) {
  const existing = await loadOwnSubmission(ctx, user.id);
  assertWritable(ctx, existing, user.id);

  await assertTrackInEvent(ctx.event.id, input.trackId);
  await assertQuestionsInEvent(ctx.event.id, input.answers);
  await assertChallengesInEvent(ctx.event.id, input.challengeIds);

  const data: Prisma.SubmissionUpdateInput = {};
  if (input.name !== undefined) data.name = input.name.trim();
  if (input.tagline !== undefined) data.tagline = input.tagline?.trim() || null;
  if (input.description !== undefined) data.description = input.description;
  if (input.thumbnailUrl !== undefined) data.thumbnailUrl = input.thumbnailUrl;
  if (input.repoUrl !== undefined) data.repoUrl = input.repoUrl;
  if (input.liveUrl !== undefined) data.liveUrl = input.liveUrl;
  if (input.videoUrl !== undefined) data.videoUrl = input.videoUrl;
  if (input.techTags !== undefined) data.techTags = input.techTags;
  if (input.challengeIds !== undefined) data.challengeIds = input.challengeIds;
  if (input.license !== undefined) data.license = input.license;
  if (input.declarations !== undefined) {
    data.declarations = input.declarations as Prisma.InputJsonValue;
  }
  if (input.trackId !== undefined) {
    data.track = input.trackId ? { connect: { id: input.trackId } } : { disconnect: true };
  }

  const updated = await prisma.$transaction(async (tx) => {
    await tx.submission.update({ where: { id: existing.id }, data });

    if (input.images !== undefined) {
      await tx.submissionImage.deleteMany({ where: { submissionId: existing.id } });
      if (input.images.length) {
        await tx.submissionImage.createMany({
          data: input.images.map((img, i) => ({
            submissionId: existing.id,
            url: img.url,
            caption: img.caption ?? null,
            position: i,
          })),
        });
      }
    }

    if (input.answers !== undefined) {
      for (const answer of input.answers) {
        await tx.customAnswer.upsert({
          where: {
            submissionId_questionId: {
              submissionId: existing.id,
              questionId: answer.questionId,
            },
          },
          create: {
            submissionId: existing.id,
            questionId: answer.questionId,
            value: answer.value,
          },
          update: { value: answer.value },
        });
      }
    }

    return tx.submission.findUniqueOrThrow({
      where: { id: existing.id },
      include: submissionInclude,
    });
  });

  await recordAudit({
    action: AuditAction.SUBMISSION_UPDATED,
    eventId: ctx.event.id,
    actorId: user.id,
    targetType: "submission",
    targetId: existing.id,
    summary: `Submission "${updated.name}" updated`,
    ipHash,
  });

  return updated;
}

/** Required fields are only enforced on submit, so drafts can be saved freely. */
function assertComplete(submission: {
  name: string;
  tagline: string | null;
  description: string | null;
}): void {
  const errors: Record<string, string> = {};
  if (!submission.name?.trim()) errors.name = "A project name is required.";
  if (!submission.tagline?.trim()) errors.tagline = "A tagline is required.";
  if ((submission.description ?? "").trim().length < 40) {
    errors.description = "Judges need at least a paragraph (40 characters).";
  }
  if (Object.keys(errors).length) {
    throw badRequest("This submission is not complete yet.", errors);
  }
}

export async function submitSubmission(ctx: EventContext, user: AuthUser, ipHash?: string) {
  const existing = await loadOwnSubmission(ctx, user.id);
  assertWritable(ctx, existing, user.id);
  assertComplete(existing);

  const required = await prisma.customQuestion.findMany({
    where: { eventId: ctx.event.id, required: true, stage: "SUBMISSION" },
    select: { id: true, prompt: true },
  });
  const answered = new Set(
    existing.answers.filter((a) => a.value.trim().length > 0).map((a) => a.questionId),
  );
  const missing = required.filter((q) => !answered.has(q.id));
  if (missing.length) {
    throw badRequest("Answer the organizer's required questions before submitting.", {
      questions: missing.map((q) => q.prompt),
    });
  }

  const updated = await prisma.submission.update({
    where: { id: existing.id },
    data: { status: SubmissionStatus.SUBMITTED, submittedAt: new Date() },
    include: submissionInclude,
  });

  await recordAudit({
    action: AuditAction.SUBMISSION_SUBMITTED,
    eventId: ctx.event.id,
    actorId: user.id,
    targetType: "submission",
    targetId: existing.id,
    summary: `Submission "${updated.name}" submitted for judging`,
    ipHash,
  });

  return updated;
}

export async function withdrawSubmission(ctx: EventContext, user: AuthUser, ipHash?: string) {
  const existing = await loadOwnSubmission(ctx, user.id);
  assertWritable(ctx, existing, user.id);

  const updated = await prisma.submission.update({
    where: { id: existing.id },
    data: { status: SubmissionStatus.WITHDRAWN },
    include: submissionInclude,
  });

  await recordAudit({
    action: AuditAction.SUBMISSION_WITHDRAWN,
    eventId: ctx.event.id,
    actorId: user.id,
    targetType: "submission",
    targetId: existing.id,
    summary: `Submission "${updated.name}" withdrawn`,
    ipHash,
  });

  return updated;
}

/** Hides a submitted project from the gallery, judging, voting and results. The row and its scores stay. */
export async function flagSubmission(ctx: EventContext, submissionId: string, reason: string, ipHash?: string) {
  const existing = await prisma.submission.findFirst({ where: { id: submissionId, eventId: ctx.event.id } });
  if (!existing) throw notFound("Submission not found.");
  if (existing.status !== SubmissionStatus.SUBMITTED) {
    throw badRequest("Only a submitted project can be flagged.");
  }

  const updated = await prisma.submission.update({
    where: { id: existing.id },
    data: {
      status: SubmissionStatus.DISQUALIFIED,
      flagReason: reason,
      flaggedAt: new Date(),
      flaggedById: ctx.user?.id ?? null,
    },
    include: submissionInclude,
  });

  await recordAudit({
    action: AuditAction.SUBMISSION_FLAGGED,
    eventId: ctx.event.id,
    actorId: ctx.user?.id ?? null,
    targetType: "submission",
    targetId: existing.id,
    summary: `Submission "${updated.name}" flagged and hidden: ${reason}`,
    metadata: { reason },
    ipHash,
  });

  return updated;
}

export async function restoreSubmission(ctx: EventContext, submissionId: string, ipHash?: string) {
  const existing = await prisma.submission.findFirst({ where: { id: submissionId, eventId: ctx.event.id } });
  if (!existing) throw notFound("Submission not found.");
  if (existing.status !== SubmissionStatus.DISQUALIFIED) {
    throw badRequest("That project is not flagged.");
  }

  const updated = await prisma.submission.update({
    where: { id: existing.id },
    data: { status: SubmissionStatus.SUBMITTED, flagReason: null, flaggedAt: null, flaggedById: null },
    include: submissionInclude,
  });

  await recordAudit({
    action: AuditAction.SUBMISSION_RESTORED,
    eventId: ctx.event.id,
    actorId: ctx.user?.id ?? null,
    targetType: "submission",
    targetId: existing.id,
    summary: `Submission "${updated.name}" restored to public view`,
    ipHash,
  });

  return updated;
}

/** Organizer override: lock or unlock one entry regardless of the deadline. */
export async function setSubmissionLock(
  ctx: EventContext,
  submissionId: string,
  locked: boolean,
  ipHash?: string,
) {
  const existing = await prisma.submission.findFirst({
    where: { id: submissionId, eventId: ctx.event.id },
  });
  if (!existing) throw notFound("Submission not found.");

  const updated = await prisma.submission.update({
    where: { id: existing.id },
    data: { lockedAt: locked ? new Date() : null },
    include: submissionInclude,
  });

  await recordAudit({
    action: AuditAction.SUBMISSION_LOCKED,
    eventId: ctx.event.id,
    actorId: ctx.user?.id ?? null,
    targetType: "submission",
    targetId: existing.id,
    summary: `Submission "${updated.name}" ${locked ? "locked" : "unlocked"}`,
    ipHash,
  });

  return updated;
}
