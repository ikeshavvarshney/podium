import { JudgingMode } from "@prisma/client";
import { bordaCount, buildGroups, groupKey } from "../algorithms/pairwise.js";
import { prisma } from "../db.js";
import { badRequest, conflict, forbidden } from "../lib/errors.js";
import { AuditAction, recordAudit } from "./audit.service.js";
import type { EventContext } from "./authorization.service.js";
import { requireRubric } from "./rubric.service.js";

const submissionCard = {
  id: true,
  name: true,
  tagline: true,
  thumbnailUrl: true,
  team: { select: { id: true, name: true } },
  track: { select: { id: true, name: true } },
} as const;

async function assertComparativeMode(eventId: string) {
  const rubric = await requireRubric(eventId);
  if (rubric.mode !== JudgingMode.COMPARATIVE) {
    throw conflict("This event scores on a weighted rubric, not comparative ranking.");
  }
  return rubric;
}

/**
 * The judge's own groups. Built from their own assignments, so comparative
 * mode inherits the assignment engine's isolation and track scoping rather
 * than inventing a second set of rules.
 */
export async function getMyGroups(ctx: EventContext, judgeId: string) {
  const rubric = await assertComparativeMode(ctx.event.id);

  const assignments = await prisma.judgeAssignment.findMany({
    where: { eventId: ctx.event.id, judgeId },
    select: { submissionId: true },
    orderBy: { position: "asc" },
  });

  const groups = buildGroups(
    assignments.map((a) => a.submissionId),
    rubric.groupSize,
    judgeId,
  );

  const submissions = await prisma.submission.findMany({
    where: { id: { in: assignments.map((a) => a.submissionId) } },
    select: submissionCard,
  });
  const byId = new Map(submissions.map((s) => [s.id, s]));

  const finished = await prisma.pairwiseRanking.findMany({
    where: { eventId: ctx.event.id, judgeId },
    select: { groupKey: true, order: true, skipped: true },
  });
  const done = new Map(finished.map((f) => [f.groupKey, f]));

  return {
    mode: "COMPARATIVE" as const,
    groupSize: rubric.groupSize,
    total: groups.length,
    completed: finished.filter((f) => !f.skipped).length,
    groups: groups.map((g) => ({
      key: g.key,
      submissions: g.submissionIds.map((id) => byId.get(id)).filter(Boolean),
      ranking: done.get(g.key)?.order ?? null,
      skipped: done.get(g.key)?.skipped ?? false,
    })),
  };
}

/** Records one finished ranking. The order is validated against the group. */
export async function submitRanking(
  ctx: EventContext,
  judgeId: string,
  input: { order: string[]; skipped?: boolean },
  ipHash?: string,
) {
  await assertComparativeMode(ctx.event.id);

  if (new Set(input.order).size !== input.order.length) {
    throw badRequest("A ranking may list each project only once.");
  }
  if (input.order.length < 2) {
    throw badRequest("A ranking needs at least two projects.");
  }

  // Every project must be one this judge was actually assigned.
  const assigned = await prisma.judgeAssignment.findMany({
    where: { eventId: ctx.event.id, judgeId, submissionId: { in: input.order } },
    select: { submissionId: true },
  });
  if (assigned.length !== input.order.length) {
    throw forbidden("That ranking includes a project you are not assigned.");
  }

  const key = groupKey(input.order);
  const ranking = await prisma.pairwiseRanking.upsert({
    where: { eventId_judgeId_groupKey: { eventId: ctx.event.id, judgeId, groupKey: key } },
    create: {
      eventId: ctx.event.id,
      judgeId,
      groupKey: key,
      order: input.order,
      skipped: input.skipped ?? false,
    },
    update: { order: input.order, skipped: input.skipped ?? false },
  });

  await recordAudit({
    action: AuditAction.RANKING_SUBMITTED,
    eventId: ctx.event.id,
    actorId: judgeId,
    targetType: "pairwise_ranking",
    targetId: ranking.id,
    summary: `Comparative ranking recorded over ${input.order.length} projects`,
    metadata: { groupKey: key, skipped: ranking.skipped },
    ipHash,
  });

  return ranking;
}

/**
 * Provisional standings from every ranking filed so far. Visible to the judge
 * as a running total of their own work, and to organizers across the panel.
 */
export async function getBordaStandings(ctx: EventContext, judgeId?: string) {
  await assertComparativeMode(ctx.event.id);

  const rankings = await prisma.pairwiseRanking.findMany({
    where: { eventId: ctx.event.id, skipped: false, ...(judgeId ? { judgeId } : {}) },
    select: { order: true },
  });

  const submissions = await prisma.submission.findMany({
    where: { eventId: ctx.event.id },
    select: submissionCard,
  });
  const byId = new Map(submissions.map((s) => [s.id, s]));

  const rows = bordaCount(
    rankings.map((r) => ({ order: r.order })),
    submissions.map((s) => s.id),
  );

  return {
    method: "BORDA" as const,
    rankings: rankings.length,
    standings: rows
      .filter((row) => row.appearances > 0)
      .map((row) => ({ ...row, submission: byId.get(row.submissionId) ?? null })),
  };
}
