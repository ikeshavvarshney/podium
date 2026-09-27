import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../lib/async-handler.js";
import { currentUser, requireAuth } from "../middleware/auth.js";
import { eventContext, loadEventContext } from "../middleware/event-context.js";
import { writeRateLimit } from "../middleware/rate-limit.js";
import { validate } from "../middleware/validate.js";
import {
  askToJoin,
  decideRequest,
  getBoard,
  invitePerson,
  myRequests,
  postListing,
} from "../services/board.service.js";

const router: Router = Router({ mergeParams: true });

const tags = z.array(z.string().trim().min(1).max(40)).max(12);

router.get(
  "/",
  asyncHandler(loadEventContext),
  asyncHandler(async (req, res) => {
    res.json(await getBoard(eventContext(req)));
  }),
);

router.post(
  "/listing",
  requireAuth,
  asyncHandler(loadEventContext),
  writeRateLimit,
  validate({
    body: z.object({
      pitch: z.string().trim().min(1, "Say what you are building or want to work on.").max(500),
      needs: tags.optional(),
      skills: tags.optional(),
      trackId: z.string().uuid().nullish(),
    }),
  }),
  asyncHandler(async (req, res) => {
    res.status(201).json(await postListing(eventContext(req), currentUser(req), req.body, req.ipHash));
  }),
);

router.post(
  "/requests",
  requireAuth,
  asyncHandler(loadEventContext),
  writeRateLimit,
  validate({
    body: z
      .object({
        teamId: z.string().uuid().optional(),
        userId: z.string().uuid().optional(),
        message: z.string().trim().max(500).optional(),
      })
      .refine((b) => Boolean(b.teamId) !== Boolean(b.userId), "Name either a team or a person."),
  }),
  asyncHandler(async (req, res) => {
    const ctx = eventContext(req);
    const user = currentUser(req);
    const request = req.body.teamId
      ? await askToJoin(ctx, user, req.body.teamId, req.body.message, req.ipHash)
      : await invitePerson(ctx, user, req.body.userId, req.body.message, req.ipHash);
    res.status(201).json(request);
  }),
);

router.get(
  "/requests/mine",
  requireAuth,
  asyncHandler(loadEventContext),
  asyncHandler(async (req, res) => {
    res.json(await myRequests(eventContext(req), currentUser(req)));
  }),
);

router.post(
  "/requests/:requestId/:decision",
  requireAuth,
  asyncHandler(loadEventContext),
  validate({ params: z.object({ requestId: z.string().uuid(), decision: z.enum(["accept", "decline"]) }) }),
  asyncHandler(async (req, res) => {
    res.json(
      await decideRequest(
        eventContext(req),
        currentUser(req),
        req.params.requestId as string,
        req.params.decision === "accept",
        req.ipHash,
      ),
    );
  }),
);

export default router;
