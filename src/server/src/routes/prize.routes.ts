import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { asyncHandler } from "../lib/async-handler.js";
import { badRequest, notFound } from "../lib/errors.js";
import { requireAuth } from "../middleware/auth.js";
import {
  eventContext,
  loadEventContext,
  requireEventAdmin,
} from "../middleware/event-context.js";
import { validate } from "../middleware/validate.js";
import { AuditAction, recordAudit } from "../services/audit.service.js";

const router: Router = Router({ mergeParams: true });

const prizeSchema = z.object({
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2000).optional(),
  trackId: z.string().uuid().nullish(),
  amountCents: z.number().int().min(0).max(1_000_000_00).nullish(),
  currency: z.string().trim().length(3).optional(),
  quantity: z.number().int().min(1).max(100).optional(),
  position: z.number().int().min(0).max(999).optional(),
});

/** A prize may only point at a track belonging to the same event. */
async function assertTrackInEvent(eventId: string, trackId?: string | null): Promise<void> {
  if (!trackId) return;
  const track = await prisma.track.findFirst({
    where: { id: trackId, eventId },
    select: { id: true },
  });
  if (!track) throw badRequest("That track does not belong to this event.");
}

router.get(
  "/",
  asyncHandler(loadEventContext),
  asyncHandler(async (req, res) => {
    res.json(
      await prisma.prize.findMany({
        where: { eventId: eventContext(req).event.id },
        orderBy: { position: "asc" },
        include: { track: { select: { id: true, name: true } } },
      }),
    );
  }),
);

router.post(
  "/",
  requireAuth,
  asyncHandler(loadEventContext),
  requireEventAdmin,
  validate({ body: prizeSchema }),
  asyncHandler(async (req, res) => {
    const ctx = eventContext(req);
    await assertTrackInEvent(ctx.event.id, req.body.trackId);

    const prize = await prisma.prize.create({
      data: {
        eventId: ctx.event.id,
        title: req.body.title,
        description: req.body.description ?? null,
        trackId: req.body.trackId ?? null,
        amountCents: req.body.amountCents ?? null,
        currency: req.body.currency ?? "USD",
        quantity: req.body.quantity ?? 1,
        position: req.body.position ?? 0,
      },
    });
    await recordAudit({
      action: AuditAction.PRIZE_CREATED,
      eventId: ctx.event.id,
      actorId: ctx.user?.id ?? null,
      targetType: "prize",
      targetId: prize.id,
      summary: `Prize "${prize.title}" created`,
      ipHash: req.ipHash,
    });
    res.status(201).json(prize);
  }),
);

router.patch(
  "/:prizeId",
  requireAuth,
  asyncHandler(loadEventContext),
  requireEventAdmin,
  validate({ body: prizeSchema.partial() }),
  asyncHandler(async (req, res) => {
    const ctx = eventContext(req);
    const existing = await prisma.prize.findFirst({
      where: { id: req.params.prizeId as string, eventId: ctx.event.id },
    });
    if (!existing) throw notFound("Prize not found.");
    await assertTrackInEvent(ctx.event.id, req.body.trackId);

    const prize = await prisma.prize.update({
      where: { id: existing.id },
      data: req.body,
    });
    await recordAudit({
      action: AuditAction.PRIZE_UPDATED,
      eventId: ctx.event.id,
      actorId: ctx.user?.id ?? null,
      targetType: "prize",
      targetId: prize.id,
      summary: `Prize "${prize.title}" updated`,
      ipHash: req.ipHash,
    });
    res.json(prize);
  }),
);

router.delete(
  "/:prizeId",
  requireAuth,
  asyncHandler(loadEventContext),
  requireEventAdmin,
  asyncHandler(async (req, res) => {
    const ctx = eventContext(req);
    const existing = await prisma.prize.findFirst({
      where: { id: req.params.prizeId as string, eventId: ctx.event.id },
    });
    if (!existing) throw notFound("Prize not found.");

    await prisma.prize.delete({ where: { id: existing.id } });
    await recordAudit({
      action: AuditAction.PRIZE_DELETED,
      eventId: ctx.event.id,
      actorId: ctx.user?.id ?? null,
      targetType: "prize",
      targetId: existing.id,
      summary: `Prize "${existing.title}" deleted`,
      ipHash: req.ipHash,
    });
    res.status(204).end();
  }),
);

export default router;
