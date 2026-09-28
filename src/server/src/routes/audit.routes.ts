import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { asyncHandler } from "../lib/async-handler.js";
import { requireAuth } from "../middleware/auth.js";
import { eventContext, loadEventContext, requireEventAdmin } from "../middleware/event-context.js";
import { validate } from "../middleware/validate.js";
import { verifyAuditChain } from "../services/audit.service.js";

const router: Router = Router({ mergeParams: true });

/**
 * The event's audit trail, organizer-only. Append-only rows, newest first, so
 * an organizer can read what happened without a database client.
 */
router.get(
  "/",
  requireAuth,
  asyncHandler(loadEventContext),
  requireEventAdmin,
  validate({
    query: z.object({
      take: z.coerce.number().int().min(1).max(200).optional(),
      action: z.string().trim().max(60).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const ctx = eventContext(req);
    const entries = await prisma.auditLog.findMany({
      where: {
        eventId: ctx.event.id,
        ...(req.query.action ? { action: String(req.query.action) } : {}),
      },
      // Chain order is insertion order, which a back-dated timestamp cannot disturb.
      orderBy: [{ chainSeq: "desc" }, { createdAt: "desc" }],
      take: Number(req.query.take ?? 40),
      select: {
        id: true,
        action: true,
        summary: true,
        targetType: true,
        targetId: true,
        metadata: true,
        ipHash: true,
        createdAt: true,
        chainSeq: true,
        hash: true,
        actor: { select: { id: true, name: true } },
      },
    });
    res.json(entries);
  }),
);

/** Recomputes the event's audit hash chain and reports the first break, if any. */
router.get(
  "/verify",
  requireAuth,
  asyncHandler(loadEventContext),
  requireEventAdmin,
  asyncHandler(async (req, res) => {
    res.json(await verifyAuditChain(eventContext(req).event.id));
  }),
);

export default router;
