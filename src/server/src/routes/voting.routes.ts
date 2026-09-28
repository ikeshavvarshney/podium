import { VotingAccess, VotingMethod } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { config } from "../config.js";
import { asyncHandler } from "../lib/async-handler.js";
import { eventContext, loadEventContext, requireEventAdmin } from "../middleware/event-context.js";
import { requireAuth } from "../middleware/auth.js";
import { rateLimit } from "../middleware/rate-limit.js";
import { validate } from "../middleware/validate.js";
import {
  castBallot,
  confirmVoterCode,
  getBallot,
  getVoteResults,
  getVotingConfigForAdmin,
  listBallots,
  requestVoterCode,
  resolveVoterToken,
  upsertVotingConfig,
  type VoterClaims,
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
  maxChoices: z.number().int().min(1).max(200).nullable().optional(),
});

const ballotSchema = z.object({
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

const DEVICE_COOKIE = "podium_voter_device";
const VOTER_COOKIE = "podium_voter_token";
const cookie = (maxAgeMs: number) => ({
  httpOnly: true,
  secure: config.COOKIE_SECURE,
  sameSite: "lax" as const,
  path: "/",
  maxAge: maxAgeMs,
});

/** The device cookie (issued on first sight) and any voter token, from cookie or header. */
async function voterClaims(req: Request, res: Response): Promise<VoterClaims> {
  let deviceId = req.cookies?.[DEVICE_COOKIE] as string | undefined;
  if (!deviceId || !/^[0-9a-f-]{36}$/.test(deviceId)) {
    deviceId = randomUUID();
    res.cookie(DEVICE_COOKIE, deviceId, cookie(365 * 24 * 60 * 60_000));
  }
  const token = req.get("x-voter-token") ?? (req.cookies?.[VOTER_COOKIE] as string | undefined);
  return { deviceId, verifiedEmail: await resolveVoterToken(eventContext(req), token) };
}

const codeRequestLimit = rateLimit("voter-code", {
  windowMs: 15 * 60_000,
  max: 5,
  key: (req) => `${req.params.eventId}:${String(req.body?.email ?? "").trim().toLowerCase()}`,
  message: "A code was requested for this address several times. Try again in a few minutes.",
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
  asyncHandler(async (req, res) => {
    res.json(await getBallot(eventContext(req), await voterClaims(req, res), req.ipHash));
  }),
);

/** Email-gated voting, step one: a six-digit code to the address. */
router.post(
  "/voting/verify",
  asyncHandler(loadEventContext),
  ballotRateLimit,
  codeRequestLimit,
  validate({ body: z.object({ email: z.string().trim().email().max(200) }) }),
  asyncHandler(async (req, res) => {
    const { delivered } = await requestVoterCode(eventContext(req), req.body.email, req.ipHash);
    res.status(202).json({ delivered, message: "If the address can receive mail, a code is on its way." });
  }),
);

/** Step two: the code for a voter token, also set as a cookie for the browser. */
router.post(
  "/voting/verify/confirm",
  asyncHandler(loadEventContext),
  ballotRateLimit,
  validate({ body: z.object({ email: z.string().trim().email().max(200), code: z.string().trim().regex(/^\d{6}$/) }) }),
  asyncHandler(async (req, res) => {
    const verified = await confirmVoterCode(eventContext(req), req.body.email, req.body.code, req.ipHash);
    res.cookie(VOTER_COOKIE, verified.token, cookie(30 * 24 * 60 * 60_000));
    res.json(verified);
  }),
);

router.post(
  "/votes",
  asyncHandler(loadEventContext),
  ballotRateLimit,
  validate({ body: ballotSchema }),
  asyncHandler(async (req, res) => {
    res.status(201).json(
      await castBallot(
        eventContext(req),
        req.body,
        await voterClaims(req, res),
        req.ipHash,
        req.get("user-agent") ?? undefined,
      ),
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
