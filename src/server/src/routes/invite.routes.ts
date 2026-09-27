import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../lib/async-handler.js";
import { currentUser, requireAuth } from "../middleware/auth.js";
import { rateLimit } from "../middleware/rate-limit.js";
import { validate } from "../middleware/validate.js";
import { acceptInvite } from "../services/team.service.js";

const router: Router = Router();

/** Tight limit: this endpoint is the one place an invite token can be guessed. */
const inviteLimit = rateLimit("invite-accept", {
  windowMs: 10 * 60_000,
  max: 20,
  message: "Too many invite attempts. Try again shortly.",
});

router.post(
  "/accept",
  requireAuth,
  inviteLimit,
  validate({ body: z.object({ token: z.string().trim().min(10).max(200) }) }),
  asyncHandler(async (req, res) => {
    const team = await acceptInvite(currentUser(req), req.body.token, req.ipHash);
    res.status(200).json(team);
  }),
);

export default router;
