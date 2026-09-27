import { VotingAccess, VotingMethod } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../lib/async-handler.js";
import { eventContext, loadEventContext, requireEventAdmin } from "../middleware/event-context.js";
import { requireAuth } from "../middleware/auth.js";
import { rateLimit } from "../middleware/rate-limit.js";
import { validate } from "../middleware/validate.js";
import {
  castBallot,
  getBallot,
  getVoteResults,
  getVotingConfigForAdmin,
  listBallots,
  upsertVotingConfig,
} from "../services/voting.service.js";

const router: Router = Router({ mergeParams: true });

const configSchema = z.object({
  enabled: z.boolean().optional(),
  access: z.nativeEnum(VotingAccess).optional(),
  method: z.nativeEnum(VotingMethod).optional(),
  creditBudget: z.number().int().min(1).max(10000).optional(),
  hideResults: z.boolean().optional(),
  shuffleBallot: z.boolean().optional(),
  allowVisitors: z.boolean().optional(),
  allowParticipants: z.boolean().optional(),
  allowJudges: z.boolean().optional(),
  allowAdmins: z.boolean().optional(),
  maxVotesPerIpPerHour: z.number().int().min(1).max(10000).optional(),
});

const ballotSchema = z.object({
  email: z.string().trim().email().max(200).optional(),
  entries: z
    .array(
      z.object({
        submissionId: z.string().uuid(),
        weight: z.number().int().min(0).max(100),
      }),
    )
    .max(200),
});

/**
 * Ballots are the one write path open to unauthenticated callers, so they carry
 * their own limiter keyed on the hashed client address.
 */
const ballotRateLimit = rateLimit("vote", {
  windowMs: 60 * 60_000,
  max: 60,
  message: "Too many ballots from this address. Try again later.",
});

router.get(
  "/voting/config",
  requireAuth,
  asyncHandler(loadEventContext),
  requireEventAdmin,
  asyncHandler(async (req, res) => {
    res.json(await getVotingConfigForAdmin(eventContext(req)));
  }),
);

router.put(
  "/voting/config",
  requireAuth,
  asyncHandler(loadEventContext),
  requireEventAdmin,
  validate({ body: configSchema }),
  asyncHandler(async (req, res) => {
    res.json(await upsertVotingConfig(eventContext(req), req.body, req.ipHash));
  }),
);

router.get(
  "/voting/ballot",
  asyncHandler(loadEventContext),
  validate({ query: z.object({ email: z.string().trim().email().max(200).optional() }) }),
  asyncHandler(async (req, res) => {
    res.json(await getBallot(eventContext(req), req.query.email as string | undefined, req.ipHash));
  }),
);

router.post(
  "/votes",
  asyncHandler(loadEventContext),
  ballotRateLimit,
  validate({ body: ballotSchema }),
  asyncHandler(async (req, res) => {
    res.status(201).json(
      await castBallot(eventContext(req), req.body, req.ipHash, req.get("user-agent") ?? undefined),
    );
  }),
);

router.get(
  "/votes/ballots",
  requireAuth,
  asyncHandler(loadEventContext),
  requireEventAdmin,
  asyncHandler(async (req, res) => {
    res.json(await listBallots(eventContext(req)));
  }),
);

router.get(
  "/votes/results",
  asyncHandler(loadEventContext),
  asyncHandler(async (req, res) => {
    res.json(await getVoteResults(eventContext(req)));
  }),
);

export default router;
