import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { asyncHandler } from "../lib/async-handler.js";
import { notFound } from "../lib/errors.js";
import { requireAuth } from "../middleware/auth.js";
import {
  eventContext,
  loadEventContext,
  requireEventAdmin,
} from "../middleware/event-context.js";
import { validate } from "../middleware/validate.js";
import { AuditAction, recordAudit } from "../services/audit.service.js";
import { slugify } from "../services/event.service.js";

const router: Router = Router({ mergeParams: true });

const trackSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(2000).optional(),
  restricted: z.boolean().optional(),
  position: z.number().int().min(0).max(999).optional(),
});

router.get(
  "/",
  asyncHandler(loadEventContext),
  asyncHandler(async (req, res) => {
    res.json(
      await prisma.track.findMany({
        where: { eventId: eventContext(req).event.id },
        orderBy: { position: "asc" },
      }),
    );
  }),
);

router.post(
  "/",
  requireAuth,
  asyncHandler(loadEventContext),
  requireEventAdmin,
  validate({ body: trackSchema }),
  asyncHandler(async (req, res) => {
    const ctx = eventContext(req);
    const track = await prisma.track.create({
      data: {
        eventId: ctx.event.id,
        name: req.body.name,
        slug: slugify(req.body.name),
        description: req.body.description ?? null,
        restricted: req.body.restricted ?? false,
        position: req.body.position ?? 0,
      },
    });
    await recordAudit({
      action: AuditAction.TRACK_CREATED,
      eventId: ctx.event.id,
      actorId: ctx.user?.id ?? null,
      targetType: "track",
      targetId: track.id,
      summary: `Track "${track.name}" created`,
      ipHash: req.ipHash,
    });
    res.status(201).json(track);
  }),
);

async function loadTrack(eventId: string, trackId: string) {
  const track = await prisma.track.findFirst({ where: { id: trackId, eventId } });
  if (!track) throw notFound("Track not found.");
  return track;
}

router.patch(
  "/:trackId",
  requireAuth,
  asyncHandler(loadEventContext),
  requireEventAdmin,
  validate({ body: trackSchema.partial() }),
  asyncHandler(async (req, res) => {
    const ctx = eventContext(req);
    const existing = await loadTrack(ctx.event.id, req.params.trackId as string);
    const track = await prisma.track.update({
      where: { id: existing.id },
      data: {
        ...(req.body.name !== undefined
          ? { name: req.body.name, slug: slugify(req.body.name) }
          : {}),
        ...(req.body.description !== undefined ? { description: req.body.description } : {}),
        ...(req.body.restricted !== undefined ? { restricted: req.body.restricted } : {}),
        ...(req.body.position !== undefined ? { position: req.body.position } : {}),
      },
    });
    await recordAudit({
      action: AuditAction.TRACK_UPDATED,
      eventId: ctx.event.id,
      actorId: ctx.user?.id ?? null,
      targetType: "track",
      targetId: track.id,
      summary: `Track "${track.name}" updated`,
      ipHash: req.ipHash,
    });
    res.json(track);
  }),
);

router.delete(
  "/:trackId",
  requireAuth,
  asyncHandler(loadEventContext),
  requireEventAdmin,
  asyncHandler(async (req, res) => {
    const ctx = eventContext(req);
    const track = await loadTrack(ctx.event.id, req.params.trackId as string);
    await prisma.track.delete({ where: { id: track.id } });
    await recordAudit({
      action: AuditAction.TRACK_DELETED,
      eventId: ctx.event.id,
      actorId: ctx.user?.id ?? null,
      targetType: "track",
      targetId: track.id,
      summary: `Track "${track.name}" deleted`,
      ipHash: req.ipHash,
    });
    res.status(204).end();
  }),
);

export default router;
