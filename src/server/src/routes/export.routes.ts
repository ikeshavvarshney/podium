import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../lib/async-handler.js";
import { requireAuth } from "../middleware/auth.js";
import {
  eventContext,
  loadEventContext,
  requireEventAdmin,
} from "../middleware/event-context.js";
import { validate } from "../middleware/validate.js";
import {
  exportAudit,
  exportEventJson,
  exportJudges,
  exportResults,
  exportScores,
  exportSubmissions,
  exportTeams,
} from "../services/export.service.js";

const router: Router = Router({ mergeParams: true });

function sendCsv(res: import("express").Response, filename: string, body: string): void {
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(body);
}

const guards = [requireAuth, asyncHandler(loadEventContext), requireEventAdmin] as const;

router.get(
  "/submissions.csv",
  ...guards,
  asyncHandler(async (req, res) => {
    const ctx = eventContext(req);
    sendCsv(res, `${ctx.event.slug}-submissions.csv`, await exportSubmissions(ctx));
  }),
);

router.get(
  "/teams.csv",
  ...guards,
  asyncHandler(async (req, res) => {
    const ctx = eventContext(req);
    sendCsv(res, `${ctx.event.slug}-teams.csv`, await exportTeams(ctx));
  }),
);

router.get(
  "/judges.csv",
  ...guards,
  asyncHandler(async (req, res) => {
    const ctx = eventContext(req);
    sendCsv(res, `${ctx.event.slug}-judges.csv`, await exportJudges(ctx));
  }),
);

router.get(
  "/scores.csv",
  ...guards,
  asyncHandler(async (req, res) => {
    const ctx = eventContext(req);
    sendCsv(res, `${ctx.event.slug}-scores.csv`, await exportScores(ctx));
  }),
);

router.get(
  "/results.csv",
  ...guards,
  validate({ query: z.object({ runId: z.string().uuid().optional() }) }),
  asyncHandler(async (req, res) => {
    const ctx = eventContext(req);
    sendCsv(
      res,
      `${ctx.event.slug}-results.csv`,
      await exportResults(ctx, req.query.runId as string | undefined),
    );
  }),
);

router.get(
  "/audit.csv",
  ...guards,
  asyncHandler(async (req, res) => {
    const ctx = eventContext(req);
    sendCsv(res, `${ctx.event.slug}-audit.csv`, await exportAudit(ctx));
  }),
);

router.get(
  "/event.json",
  ...guards,
  asyncHandler(async (req, res) => {
    const ctx = eventContext(req);
    res.setHeader("Content-Disposition", `attachment; filename="${ctx.event.slug}.json"`);
    res.json(await exportEventJson(ctx));
  }),
);

export default router;
