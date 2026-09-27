import { JudgingMode, NormalizationMethod, SubmissionStatus } from "@prisma/client";
import { bordaCount } from "../algorithms/pairwise.js";
import { displayZ, normalize } from "../algorithms/normalization.js";
import { prisma } from "../db.js";
import { forbidden, notFound } from "../lib/errors.js";
import { AuditAction, recordAudit } from "./audit.service.js";
import type { EventContext } from "./authorization.service.js";

/**
 * Computes a ranking without storing it. Used for the organizer preview, so
 * switching method does not litter the audit trail with runs.
 */
export async function previewResults(ctx: EventContext, method: NormalizationMethod) {
  const rubric = await prisma.rubric.findUnique({ where: { eventId: ctx.event.id }, select: { mode: true } });
  if (rubric?.mode === JudgingMode.COMPARATIVE) return previewComparative(ctx, method);

  const [ballots, submissions] = await Promise.all([
    prisma.judgeScore.findMany({
      where: { eventId: ctx.event.id },
      select: { judgeId: true, submissionId: true, weightedTotal: true },
    }),
    prisma.submission.findMany({
      where: { eventId: ctx.event.id, status: SubmissionStatus.SUBMITTED },
      select: { id: true, name: true, team: { select: { name: true } }, track: { select: { name: true } } },
    }),
  ]);

  const result = normalize(
    ballots.map((b) => ({
      judgeId: b.judgeId,
      submissionId: b.submissionId,
      total: b.weightedTotal,
    })),
    submissions.map((s) => s.id),
    method,
  );

  const meta = new Map(submissions.map((s) => [s.id, s]));
  const judgeNames = await prisma.user.findMany({
    where: { id: { in: result.judgeStats.map((s) => s.judgeId) } },
    select: { id: true, name: true },
  });
  const nameById = new Map(judgeNames.map((j) => [j.id, j.name]));

  return {
    method,
    comparative: false,
    ballotCount: result.ballotCount,
    judgeStats: result.judgeStats.map((s) => ({
      ...s,
      name: nameById.get(s.judgeId) ?? "Unknown judge",
      tendency: s.n === 0 ? "no data" : s.mean > 74 ? "generous" : s.mean < 62 ? "harsh" : "centred",
    })),
    standings: result.results.map((row) => ({
      ...row,
      display: method === "ZSCORE" ? displayZ(row.normalizedValue) : row.normalizedValue,
      name: meta.get(row.submissionId)?.name ?? "Unknown",
      team: meta.get(row.submissionId)?.team.name ?? null,
      track: meta.get(row.submissionId)?.track?.name ?? null,
    })),
    unranked: result.unranked.map((id) => ({
      submissionId: id,
      name: meta.get(id)?.name ?? "Unknown",
    })),
  };
}

/**
 * Comparative events have no per-judge score scale to standardize: judges order small groups
 * and a Borda count combines the orders, already normalized by the points each project could
 * have earned. The same table shape is returned so preview, run and publish work unchanged.
 * All three method choices give this one ranking; raw and normalized values are the same.
 */
async function previewComparative(ctx: EventContext, method: NormalizationMethod) {
  const [rankings, submissions] = await Promise.all([
    prisma.pairwiseRanking.findMany({
      where: { eventId: ctx.event.id, skipped: false },
      select: { order: true },
    }),
    prisma.submission.findMany({
      where: { eventId: ctx.event.id, status: SubmissionStatus.SUBMITTED },
      select: { id: true, name: true, team: { select: { name: true } }, track: { select: { name: true } } },
    }),
  ]);
  const meta = new Map(submissions.map((x) => [x.id, x]));
  const rows = bordaCount(
    rankings.map((r) => ({ order: r.order })),
    submissions.map((x) => x.id),
  );
  const ranked = rows.filter((r) => r.appearances > 0);
  return {
    method,
    comparative: true,
    ballotCount: rankings.length,
    judgeStats: [],
    standings: ranked.map((r) => ({
      submissionId: r.submissionId,
      ballotCount: r.appearances,
      rawMean: Math.round(r.score * 10000) / 100,
      normalizedValue: Math.round(r.score * 10000) / 10000,
      rawRank: r.rank,
      normalizedRank: r.rank,
      rankDelta: 0,
      contributions: [],
      display: Math.round(r.score * 10000) / 10000,
      name: meta.get(r.submissionId)?.name ?? "Unknown",
      team: meta.get(r.submissionId)?.team.name ?? null,
      track: meta.get(r.submissionId)?.track?.name ?? null,
    })),
    unranked: rows
      .filter((r) => r.appearances === 0)
      .map((r) => ({ submissionId: r.submissionId, name: meta.get(r.submissionId)?.name ?? "Unknown" })),
  };
}

/**
 * Stores an immutable snapshot of a ranking, so a published result stays
 * reproducible even after more ballots arrive.
 */
export async function runNormalization(
  ctx: EventContext,
  method: NormalizationMethod,
  ipHash?: string,
) {
  const preview = await previewResults(ctx, method);
  const rubric = await prisma.rubric.findUnique({
    where: { eventId: ctx.event.id },
    include: { criteria: { orderBy: { position: "asc" } } },
  });

  const run = await prisma.normalizationRun.create({
    data: {
      eventId: ctx.event.id,
      method,
      ballotCount: preview.ballotCount,
      judgeStats: preview.judgeStats,
      parameters: {
        comparative: preview.comparative,
        reviewsPerSubmission: ctx.event.reviewsPerSubmission,
        criteria:
          rubric?.criteria.map((c) => ({ key: c.key, label: c.label, weight: c.weight })) ?? [],
      },
      scores: {
        create: preview.standings.map((row) => ({
          submissionId: row.submissionId,
          rawMean: row.rawMean,
          normalizedValue: row.normalizedValue,
          rawRank: row.rawRank,
          normalizedRank: row.normalizedRank,
          ballotCount: row.ballotCount,
        })),
      },
    },
    include: { scores: true },
  });

  await recordAudit({
    action: AuditAction.NORMALIZATION_RUN,
    eventId: ctx.event.id,
    actorId: ctx.user?.id ?? null,
    targetType: "normalization_run",
    targetId: run.id,
    summary: `Normalization run (${method}) over ${preview.ballotCount} ballots`,
    metadata: { method, ballotCount: preview.ballotCount },
    ipHash,
  });

  return { run, preview };
}

export async function listRuns(ctx: EventContext) {
  return prisma.normalizationRun.findMany({
    where: { eventId: ctx.event.id },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      method: true,
      ballotCount: true,
      createdAt: true,
      _count: { select: { scores: true } },
    },
  });
}

export async function getRun(ctx: EventContext, runId: string) {
  const run = await prisma.normalizationRun.findFirst({
    where: { id: runId, eventId: ctx.event.id },
    include: {
      scores: {
        orderBy: { normalizedRank: "asc" },
        include: {
          submission: {
            select: { id: true, name: true, team: { select: { name: true } } },
          },
        },
      },
    },
  });
  if (!run) throw notFound("Normalization run not found.");
  return run;
}

export async function publishResults(ctx: EventContext, publish: boolean, ipHash?: string) {
  if (publish) {
    const latest = await prisma.normalizationRun.findFirst({
      where: { eventId: ctx.event.id },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    if (!latest) {
      throw forbidden("Run normalization before publishing results.");
    }
  }

  const event = await prisma.event.update({
    where: { id: ctx.event.id },
    data: {
      resultsPublished: publish,
      resultsPublishedAt: publish ? new Date() : null,
      ...(publish ? { status: "RESULTS_PUBLISHED" as const } : {}),
    },
  });

  await recordAudit({
    action: AuditAction.RESULTS_PUBLISHED,
    eventId: ctx.event.id,
    actorId: ctx.user?.id ?? null,
    targetType: "event",
    targetId: ctx.event.id,
    summary: publish ? "Results published" : "Results unpublished",
    ipHash,
  });

  return event;
}

/** What the public sees once results are published: the stored run, nothing more. */
export async function getPublishedResults(ctx: EventContext) {
  if (!ctx.event.resultsPublished && !ctx.isEventAdmin) {
    throw forbidden("Results for this event have not been published yet.");
  }

  const run = await prisma.normalizationRun.findFirst({
    where: { eventId: ctx.event.id },
    orderBy: { createdAt: "desc" },
    include: {
      scores: {
        orderBy: { normalizedRank: "asc" },
        include: {
          submission: {
            select: {
              id: true,
              name: true,
              tagline: true,
              thumbnailUrl: true,
              team: { select: { name: true } },
              track: { select: { name: true } },
            },
          },
        },
      },
    },
  });
  if (!run) throw notFound("No results have been computed yet.");

  return {
    method: run.method,
    comparative: (run.parameters as { comparative?: boolean } | null)?.comparative === true,
    computedAt: run.createdAt,
    ballotCount: run.ballotCount,
    standings: run.scores.map((score) => ({
      rank: score.normalizedRank,
      rawRank: score.rawRank,
      movement: score.rawRank - score.normalizedRank,
      ballotCount: score.ballotCount,
      // Raw and normalized values stay organizer-only until publication.
      ...(ctx.isEventAdmin || ctx.event.resultsPublished
        ? { rawMean: score.rawMean, normalizedValue: score.normalizedValue }
        : {}),
      submission: score.submission,
    })),
  };
}
