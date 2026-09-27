import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../lib/async-handler.js";
import { signingPublicKey } from "../lib/signing.js";
import { validate } from "../middleware/validate.js";
import { verifyRecord } from "../services/record.service.js";

const router: Router = Router();

/** The instance public key. Anyone may read it; that is the point. */
router.get(
  "/key",
  asyncHandler(async (_req, res) => {
    res.json(signingPublicKey());
  }),
);

/**
 * Verification is deliberately open and stateless: it re-derives the signed
 * bytes from the payload it was given and checks them against the instance
 * key, so a record can be checked by someone with no account here.
 */
router.post(
  "/verify",
  validate({
    body: z.object({
      payload: z.unknown(),
      signature: z.string().trim().min(16).max(400),
    }),
  }),
  asyncHandler(async (req, res) => {
    res.json(verifyRecord({ payload: req.body.payload, signature: req.body.signature }));
  }),
);

export default router;
