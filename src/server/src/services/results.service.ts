import { JudgingMode, NormalizationMethod, SubmissionStatus } from "@prisma/client";
import { createHash } from "node:crypto";
import { bradleyTerry } from "../algorithms/bradley-terry.js";
import { bordaCount } from "../algorithms/pairwise.js";
import { displayZ, normalize } from "../algorithms/normalization.js";
import { prisma } from "../db.js";
import { conflict, forbidden, notFound } from "../lib/errors.js";
import { canonicalize } from "../lib/signing.js";
import { AuditAction, recordAudit } from "./audit.service.js";
import type { EventContext } from "./authorization.service.js";

/** Fingerprint of every input a ranking depends on: ballots, rankings and which entries count. */
export async function ballotDigest(eventId: string): Promise<string> {
  const [scores, rankings, submitted] = await Promise.all([
    prisma.judgeScore.findMany({
      where: { eventId },
      select: {
        judgeId: true,
        submissionId: true,
        weightedTotal: true,
        criterionScores: { select: { criterionId: true, value: true }, orderBy: { criterionId: "asc" } },
      },
      orderBy: [{ judgeId: "asc" }, { submissionId: "asc" }],
    }),
    prisma.pairwiseRanking.findMany({
      where: { eventId },
      select: { judgeId: true, groupKey: true, order: true, skipped: true },
      orderBy: [{ judgeId: "asc" }, { groupKey: "asc" }],
    }),
    prisma.submission.findMany({
      where: { eventId, status: SubmissionStatus.SUBMITTED },
      select: { id: true },
      orderBy: { id: "asc" },
    }),
  ]);
  return createHash("sha256")
    .update(canonicalize({ scores, rankings, submitted: submitted.map((s) => s.id) }))
    .digest("hex");
}

async function latestRunState(ctx: EventContext, digest: string) {
  const latest = await prisma.normalizationRun.findFirst({
    where: { eventId: ctx.event.id },
    orderBy: { createdAt: "desc" },
    select: { id: true, method: true, createdAt: true, ballotDigest: true },
  });
  if (!latest) return null;
  return {
    id: latest.id,
    method: latest.method,
    createdAt: latest.createdAt,
    current: latest.ballotDigest === digest,
    published: ctx.event.publishedRunId === latest.id,
  };
}

/**
 * Computes a ranking without storing it. Used for the organizer preview, so
 * switching method does not litter the audit trail with runs.
 */
export async function previewResults(ctx: EventContext, method: NormalizationMethod) {
  const digest = await ballotDigest(ctx.event.id);
  const [preview, latestRun] = await Promise.all([computePreview(ctx, method), latestRunState(ctx, digest)]);
  return { ...preview, ballotDigest: digest, latestRun };
}

async function computePreview(ctx: EventContext, method: NormalizationMethod) {
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
 * Comparative events have no per-judge score scale to standardize: judges order small groups.
 * The ranking is a Bradley-Terry fit of the pairwise wins those orders imply; the Borda share of
 * available points is kept as the "raw" column, so the table shows where the two disagree. The
 * same shape is returned so preview, run and publish work unchanged, whichever method is chosen.
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
  const ids = submissions.map((x) => x.id);
  const borda = new Map(bordaCount(rankings.map((r) => ({ order: r.order })), ids).map((r) => [r.submissionId, r]));
  const fitted = bradleyTerry(rankings.map((r) => r.order), ids);
  const ranked = new Set(fitted.map((r) => r.submissionId));
  return {
    method,
    comparative: true,
    estimator: "BRADLEY_TERRY" as const,
    ballotCount: rankings.length,
    judgeStats: [],
    standings: fitted.map((r) => {
      const b = borda.get(r.submissionId)!;
      return {
        submissionId: r.submissionId,
        ballotCount: b.appearances,
        rawMean: Math.round(b.score * 10000) / 100,
        normalizedValue: r.score,
        rawRank: b.rank,
        normalizedRank: r.rank,
        rankDelta: b.rank - r.rank,
        contributions: [],
        display: Math.round(r.score * 1000) / 1000,
        wins: r.wins,
        comparisons: r.comparisons,
        name: meta.get(r.submissionId)?.name ?? "Unknown",
        team: meta.get(r.submissionId)?.team.name ?? null,
        track: meta.get(r.submissionId)?.track?.name ?? null,
      };
    }),
    unranked: ids
      .filter((id) => !ranked.has(id))
      .map((id) => ({ submissionId: id, name: meta.get(id)?.name ?? "Unknown" })),
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
      ballotDigest: preview.ballotDigest,
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
    metadata: { method, ballotCount: preview.ballotCount, ballotDigest: preview.ballotDigest },
    ipHash,
  });

  return { run, preview };
}

export async function listRuns(ctx: EventContext) {
  const [runs, digest] = await Promise.all([
    prisma.normalizationRun.findMany({
      where: { eventId: ctx.event.id },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        method: true,
        ballotCount: true,
        ballotDigest: true,
        createdAt: true,
        _count: { select: { scores: true } },
      },
    }),
    ballotDigest(ctx.event.id),
  ]);
  return runs.map((run) => ({
    ...run,
    current: run.ballotDigest === digest,
    published: ctx.event.publishedRunId === run.id,
  }));
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

/**
 * Pins one run (the newest unless `runId` is given) as the public result. A run whose digest no
 * longer matches the ballots is refused. Publishing freezes ballots; unpublishing reopens them.
 */
export async function publishResults(ctx: EventContext, publish: boolean, ipHash?: string, runId?: string) {
  let run: { id: string; method: NormalizationMethod; ballotDigest: string | null } | null = null;
  if (publish) {
    run = await prisma.normalizationRun.findFirst({
      where: { eventId: ctx.event.id, ...(runId ? { id: runId } : {}) },
      orderBy: { createdAt: "desc" },
      select: { id: true, method: true, ballotDigest: true },
    });
    if (!run) {
      if (runId) throw notFound("Normalization run not found.");
      throw forbidden("Run normalization before publishing results.");
    }
    if (run.ballotDigest !== (await ballotDigest(ctx.event.id))) {
      throw conflict(
        "Ballots have changed since this normalization run. Run normalization again, then publish the new run.",
        { runId: run.id },
      );
    }
  }

  const event = await prisma.event.update({
    where: { id: ctx.event.id },
    data: {
      resultsPublished: publish,
      resultsPublishedAt: publish ? new Date() : null,
      publishedRunId: run?.id ?? null,
      ...(publish ? { status: "RESULTS_PUBLISHED" as const } : {}),
    },
  });

  await recordAudit({
    action: AuditAction.RESULTS_PUBLISHED,
    eventId: ctx.event.id,
    actorId: ctx.user?.id ?? null,
    targetType: run ? "normalization_run" : "event",
    targetId: run?.id ?? ctx.event.id,
    summary: run
      ? `Results published from the ${run.method} run; ballots are frozen`
      : "Results unpublished; judges may change ballots again",
    metadata: run ? { runId: run.id, method: run.method, ballotDigest: run.ballotDigest } : {},
    ipHash,
  });

  return event;
}

/** What the public sees once results are published: the stored run, nothing more. */
export async function getPublishedResults(ctx: EventContext) {
  if (!ctx.event.resultsPublished && !ctx.permissions.has("RESULTS")) {
    throw forbidden("Results for this event have not been published yet.");
  }

  const run = await prisma.normalizationRun.findFirst({
    where: ctx.event.publishedRunId ? { id: ctx.event.publishedRunId } : { eventId: ctx.event.id },
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
              status: true,
              team: { select: { name: true } },
              track: { select: { name: true } },
            },
          },
        },
      },
    },
  });
  if (!run) throw notFound("No results have been computed yet.");

  // A project flagged after the run drops out and everyone below it moves up.
  const kept = run.scores.filter((s) => s.submission.status !== SubmissionStatus.DISQUALIFIED);
  const rawRank = new Map([...kept].sort((a, b) => a.rawRank - b.rawRank).map((s, i) => [s.id, i + 1]));

  return {
    runId: run.id,
    method: run.method,
    comparative: (run.parameters as { comparative?: boolean } | null)?.comparative === true,
    computedAt: run.createdAt,
    ballotCount: run.ballotCount,
    standings: kept.map((score, i) => ({
      rank: i + 1,
      rawRank: rawRank.get(score.id)!,
      movement: rawRank.get(score.id)! - (i + 1),
      ballotCount: score.ballotCount,
      // Raw and normalized values stay organizer-only until publication.
      ...(ctx.permissions.has("RESULTS") || ctx.event.resultsPublished
        ? { rawMean: score.rawMean, normalizedValue: score.normalizedValue }
        : {}),
      submission: { ...score.submission, status: undefined },
    })),
  };
}
