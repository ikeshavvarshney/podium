import { JudgingMode, NormalizationMethod } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { asyncHandler } from "../lib/async-handler.js";
import { forbidden } from "../lib/errors.js";
import { currentUser, requireAuth } from "../middleware/auth.js";
import {
  eventContext,
  loadEventContext,
  requireEventAdmin,
  requireJudge,
} from "../middleware/event-context.js";
import { writeRateLimit } from "../middleware/rate-limit.js";
import { validate } from "../middleware/validate.js";
import { AuditAction, recordAuditSafe } from "../services/audit.service.js";
import {
  assignJudgeManually,
  clearUnscoredAssignments,
  generateAssignments,
  getJudgeScores,
  getJudgingProgress,
  getMyQueue,
  getMyScore,
  skipAssignment,
  submitScore,
  unassignJudge,
} from "../services/judging.service.js";
import {
  getPublishedResults,
  getRun,
  listRuns,
  previewResults,
  publishResults,
  runNormalization,
} from "../services/results.service.js";
import {
  getBordaStandings,
  getMyGroups,
  submitRanking,
} from "../services/pairwise.service.js";
import { buildJudgeRecord } from "../services/record.service.js";
import { getRubric, upsertRubric } from "../services/rubric.service.js";

const router: Router = Router({ mergeParams: true });

// ----------------------------------------------------------------
// Rubric
// ----------------------------------------------------------------

const rubricSchema = z.object({
  name: z.string().trim().max(120).optional(),
  mode: z.nativeEnum(JudgingMode).optional(),
  groupSize: z.number().int().min(2).max(6).optional(),
  criteria: z
    .array(
      z.object({
        key: z.string().trim().min(1).max(40),
        label: z.string().trim().min(1).max(80),
        hint: z.string().trim().max(300).nullish(),
        weight: z.number().int().min(0).max(100),
        minScore: z.number().int().min(0).max(100).optional(),
        maxScore: z.number().int().min(1).max(100).optional(),
      }),
    )
    .min(1)
    .max(20),
});

/** The rubric is public: participants are entitled to know how they are judged. */
router.get(
  "/rubric",
  asyncHandler(loadEventContext),
  asyncHandler(async (req, res) => {
    res.json(await getRubric(eventContext(req)));
  }),
);

router.put(
  "/rubric",
  requireAuth,
  asyncHandler(loadEventContext),
  requireEventAdmin,
  writeRateLimit,
  validate({ body: rubricSchema }),
  asyncHandler(async (req, res) => {
    res.json(await upsertRubric(eventContext(req), req.body, req.ipHash));
  }),
);

// ----------------------------------------------------------------
// Assignment (organizer only)
// ----------------------------------------------------------------

router.get(
  "/assignments",
  requireAuth,
  asyncHandler(loadEventContext),
  requireEventAdmin,
  asyncHandler(async (req, res) => {
    res.json(
      await prisma.judgeAssignment.findMany({
        where: { eventId: eventContext(req).event.id },
        include: {
          judge: { select: { id: true, name: true, email: true } },
          submission: { select: { id: true, name: true, track: { select: { name: true } } } },
        },
        orderBy: [{ judgeId: "asc" }, { position: "asc" }],
      }),
    );
  }),
);

router.post(
  "/assignments/generate",
  requireAuth,
  asyncHandler(loadEventContext),
  requireEventAdmin,
  writeRateLimit,
  validate({
    body: z.object({
      maxPerJudge: z.number().int().min(1).max(500).optional(),
      seed: z.number().int().optional(),
      dryRun: z.boolean().optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    res.json(await generateAssignments(eventContext(req), req.body, req.ipHash));
  }),
);

router.post(
  "/assignments",
  requireAuth,
  asyncHandler(loadEventContext),
  requireEventAdmin,
  validate({
    body: z.object({ judgeId: z.string().uuid(), submissionId: z.string().uuid() }),
  }),
  asyncHandler(async (req, res) => {
    const assignment = await assignJudgeManually(
      eventContext(req),
      req.body.judgeId,
      req.body.submissionId,
      req.ipHash,
    );
    res.status(201).json(assignment);
  }),
);

router.delete(
  "/assignments",
  requireAuth,
  asyncHandler(loadEventContext),
  requireEventAdmin,
  asyncHandler(async (req, res) => {
    res.json(await clearUnscoredAssignments(eventContext(req), req.ipHash));
  }),
);

router.delete(
  "/assignments/:assignmentId",
  requireAuth,
  asyncHandler(loadEventContext),
  requireEventAdmin,
  asyncHandler(async (req, res) => {
    await unassignJudge(eventContext(req), req.params.assignmentId as string, req.ipHash);
    res.status(204).end();
  }),
);

router.get(
  "/progress",
  requireAuth,
  asyncHandler(loadEventContext),
  requireEventAdmin,
  asyncHandler(async (req, res) => {
    res.json(await getJudgingProgress(eventContext(req)));
  }),
);

// ----------------------------------------------------------------
// Judge console. The judge is always the caller.
// ----------------------------------------------------------------

router.get(
  "/judge/queue",
  requireAuth,
  asyncHandler(loadEventContext),
  requireJudge,
  asyncHandler(async (req, res) => {
    res.json(await getMyQueue(eventContext(req), currentUser(req)));
  }),
);

const ballotSchema = z.object({
  criteria: z
    .array(z.object({ criterionId: z.string().uuid(), value: z.number().int() }))
    .min(1)
    .max(20),
  comment: z.string().trim().max(4000).nullish(),
});

router.put(
  "/judge/scores/:submissionId",
  requireAuth,
  asyncHandler(loadEventContext),
  requireJudge,
  writeRateLimit,
  validate({ body: ballotSchema }),
  asyncHandler(async (req, res) => {
    const score = await submitScore(
      eventContext(req),
      currentUser(req),
      req.params.submissionId as string,
      req.body,
      req.ipHash,
    );
    res.json(score);
  }),
);

/**
 * One judge's ballots: "me" for the caller, or a judge id. The service refuses anyone but
 * that judge or an event admin with 403.
 */
router.get(
  "/judges/:judgeId/scores",
  requireAuth,
  asyncHandler(loadEventContext),
  validate({ params: z.object({ judgeId: z.union([z.literal("me"), z.string().uuid()]) }).passthrough() }),
  asyncHandler(async (req, res) => {
    res.json(await getJudgeScores(eventContext(req), currentUser(req), req.params.judgeId as string, req.ipHash));
  }),
);

router.get(
  "/judge/scores/:submissionId",
  requireAuth,
  asyncHandler(loadEventContext),
  requireJudge,
  asyncHandler(async (req, res) => {
    res.json(
      await getMyScore(
        eventContext(req),
        currentUser(req),
        req.params.submissionId as string,
      ),
    );
  }),
);

router.post(
  "/judge/skip/:submissionId",
  requireAuth,
  asyncHandler(loadEventContext),
  requireJudge,
  validate({ body: z.object({ reason: z.string().trim().max(300).nullish() }) }),
  asyncHandler(async (req, res) => {
    res.json(
      await skipAssignment(
        eventContext(req),
        currentUser(req),
        req.params.submissionId as string,
        req.body.reason ?? null,
        req.ipHash,
      ),
    );
  }),
);

/**
 * Aggregate scores are organizer-only. A judge hitting this gets 403 even for
 * an event they judge, which is the boundary the whole product turns on.
 */
// ----------------------------------------------------------------
// Comparative ranking (an alternative to rubric scoring)
// ----------------------------------------------------------------

router.get(
  "/judge/groups",
  requireAuth,
  asyncHandler(loadEventContext),
  requireJudge,
  asyncHandler(async (req, res) => {
    res.json(await getMyGroups(eventContext(req), currentUser(req).id));
  }),
);

router.post(
  "/judge/rankings",
  requireAuth,
  asyncHandler(loadEventContext),
  requireJudge,
  writeRateLimit,
  validate({
    body: z.object({
      order: z.array(z.string().uuid()).min(2).max(6),
      skipped: z.boolean().optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    res.status(201).json(
      await submitRanking(eventContext(req), currentUser(req).id, req.body, req.ipHash),
    );
  }),
);

/** A judge sees their own running Borda table; organizers see the panel's. */
router.get(
  "/rankings/standings",
  requireAuth,
  asyncHandler(loadEventContext),
  asyncHandler(async (req, res) => {
    const ctx = eventContext(req);
    if (ctx.isEventAdmin) {
      res.json(await getBordaStandings(ctx));
      return;
    }
    if (!ctx.isJudge) throw forbidden("Only judges and organizers may read rankings.");
    res.json(await getBordaStandings(ctx, currentUser(req).id));
  }),
);

/** The judge's own signed participation record. */
router.get(
  "/judge/record",
  requireAuth,
  asyncHandler(loadEventContext),
  requireJudge,
  asyncHandler(async (req, res) => {
    const ctx = eventContext(req);
    const judge = currentUser(req);
    const record = await buildJudgeRecord(ctx, judge.id);
    recordAuditSafe({
      action: AuditAction.JUDGE_RECORD_ISSUED,
      eventId: ctx.event.id,
      actorId: judge.id,
      targetType: "judge",
      targetId: judge.id,
      summary: `${judge.name} drew their signed participation record`,
      ipHash: req.ipHash,
    });
    res.json(record);
  }),
);

router.get(
  "/scores",
  requireAuth,
  asyncHandler(loadEventContext),
  asyncHandler(async (req, res) => {
    const ctx = eventContext(req);
    if (!ctx.isEventAdmin) {
      throw forbidden("Only organizers can read the full score set for an event.");
    }
    res.json(
      await prisma.judgeScore.findMany({
        where: { eventId: ctx.event.id },
        include: {
          judge: { select: { id: true, name: true } },
          submission: { select: { id: true, name: true } },
          criterionScores: true,
        },
        orderBy: { submittedAt: "asc" },
      }),
    );
  }),
);

// ----------------------------------------------------------------
// Results
// ----------------------------------------------------------------

const methodQuery = z.object({
  method: z.nativeEnum(NormalizationMethod).optional(),
});

router.get(
  "/results/preview",
  requireAuth,
  asyncHandler(loadEventContext),
  requireEventAdmin,
  validate({ query: methodQuery }),
  asyncHandler(async (req, res) => {
    const method = (req.query.method as NormalizationMethod) ?? NormalizationMethod.ZSCORE;
    res.json(await previewResults(eventContext(req), method));
  }),
);

router.post(
  "/results/normalize",
  requireAuth,
  asyncHandler(loadEventContext),
  requireEventAdmin,
  writeRateLimit,
  validate({ body: methodQuery }),
  asyncHandler(async (req, res) => {
    const method = (req.body.method as NormalizationMethod) ?? NormalizationMethod.ZSCORE;
    const { run, preview } = await runNormalization(eventContext(req), method, req.ipHash);
    res.status(201).json({ runId: run.id, ...preview });
  }),
);

router.get(
  "/results/runs",
  requireAuth,
  asyncHandler(loadEventContext),
  requireEventAdmin,
  asyncHandler(async (req, res) => {
    res.json(await listRuns(eventContext(req)));
  }),
);

router.get(
  "/results/runs/:runId",
  requireAuth,
  asyncHandler(loadEventContext),
  requireEventAdmin,
  asyncHandler(async (req, res) => {
    res.json(await getRun(eventContext(req), req.params.runId as string));
  }),
);

router.post(
  "/results/publish",
  requireAuth,
  asyncHandler(loadEventContext),
  requireEventAdmin,
  validate({ body: z.object({ publish: z.boolean() }) }),
  asyncHandler(async (req, res) => {
    res.json(await publishResults(eventContext(req), req.body.publish, req.ipHash));
  }),
);

/** Public once published; organizer-only before that. */
router.get(
  "/results",
  asyncHandler(loadEventContext),
  asyncHandler(async (req, res) => {
    res.json(await getPublishedResults(eventContext(req)));
  }),
);

export default router;
