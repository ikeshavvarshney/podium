import { UpdateTag } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { asyncHandler } from "../lib/async-handler.js";
import { notFound } from "../lib/errors.js";
import { currentUser, requireAuth } from "../middleware/auth.js";
import { eventContext, loadEventContext, requireEventAdmin } from "../middleware/event-context.js";
import { writeRateLimit } from "../middleware/rate-limit.js";
import { validate } from "../middleware/validate.js";
import { AuditAction, recordAudit } from "../services/audit.service.js";

const router: Router = Router({ mergeParams: true });

const updateSchema = z.object({
  title: z.string().trim().min(1, "A headline is required.").max(160),
  body: z.string().trim().min(1, "An update needs a body.").max(8000),
  tag: z.nativeEnum(UpdateTag).optional(),
  pinned: z.boolean().optional(),
});

const authorSelect = {
  author: { select: { id: true, name: true, org: true, avatarHue: true } },
} as const;

/** Announcements are public: whoever may see the event may read them. */
router.get(
  "/",
  asyncHandler(loadEventContext),
  asyncHandler(async (req, res) => {
    const ctx = eventContext(req);
    const updates = await prisma.eventUpdate.findMany({
      where: { eventId: ctx.event.id },
      include: authorSelect,
      orderBy: [{ pinned: "desc" }, { createdAt: "desc" }],
    });
    // Read state is per account, and only ever the caller's own.
    const read = ctx.user
      ? new Set(
          (
            await prisma.updateRead.findMany({
              where: { userId: ctx.user.id, updateId: { in: updates.map((u) => u.id) } },
              select: { updateId: true },
            })
          ).map((r) => r.updateId),
        )
      : null;
    res.json(updates.map((u) => ({ ...u, read: read ? read.has(u.id) : true })));
  }),
);

router.post(
  "/",
  requireAuth,
  asyncHandler(loadEventContext),
  requireEventAdmin,
  writeRateLimit,
  validate({ body: updateSchema }),
  asyncHandler(async (req, res) => {
    const ctx = eventContext(req);
    const update = await prisma.eventUpdate.create({
      data: {
        eventId: ctx.event.id,
        authorId: ctx.user!.id,
        title: req.body.title,
        body: req.body.body,
        tag: req.body.tag ?? UpdateTag.LOGISTICS,
        pinned: req.body.pinned ?? false,
      },
      include: authorSelect,
    });

    await recordAudit({
      action: AuditAction.EVENT_UPDATE_POSTED,
      eventId: ctx.event.id,
      actorId: ctx.user?.id ?? null,
      targetType: "event_update",
      targetId: update.id,
      summary: `Update posted: ${update.title}`,
      ipHash: req.ipHash,
    });

    res.status(201).json(update);
  }),
);

router.post(
  "/read-all",
  requireAuth,
  asyncHandler(loadEventContext),
  asyncHandler(async (req, res) => {
    const ctx = eventContext(req);
    const user = currentUser(req);
    const updates = await prisma.eventUpdate.findMany({
      where: { eventId: ctx.event.id },
      select: { id: true },
    });
    await prisma.updateRead.createMany({
      data: updates.map((u) => ({ updateId: u.id, userId: user.id })),
      skipDuplicates: true,
    });
    res.status(204).end();
  }),
);

router.post(
  "/:updateId/read",
  requireAuth,
  asyncHandler(loadEventContext),
  asyncHandler(async (req, res) => {
    const ctx = eventContext(req);
    const update = await prisma.eventUpdate.findFirst({
      where: { id: req.params.updateId as string, eventId: ctx.event.id },
      select: { id: true },
    });
    if (!update) throw notFound("That update does not exist in this event.");
    await prisma.updateRead.upsert({
      where: { updateId_userId: { updateId: update.id, userId: currentUser(req).id } },
      create: { updateId: update.id, userId: currentUser(req).id },
      update: {},
    });
    res.status(204).end();
  }),
);

router.patch(
  "/:updateId",
  requireAuth,
  asyncHandler(loadEventContext),
  requireEventAdmin,
  validate({ body: updateSchema.partial() }),
  asyncHandler(async (req, res) => {
    const ctx = eventContext(req);
    const existing = await prisma.eventUpdate.findFirst({
      where: { id: req.params.updateId as string, eventId: ctx.event.id },
    });
    if (!existing) throw notFound("That update does not exist in this event.");

    const update = await prisma.eventUpdate.update({
      where: { id: existing.id },
      data: req.body,
      include: authorSelect,
    });

    await recordAudit({
      action: AuditAction.EVENT_UPDATE_EDITED,
      eventId: ctx.event.id,
      actorId: ctx.user?.id ?? null,
      targetType: "event_update",
      targetId: update.id,
      summary: `Update edited: ${update.title}`,
      ipHash: req.ipHash,
    });

    res.json(update);
  }),
);

router.delete(
  "/:updateId",
  requireAuth,
  asyncHandler(loadEventContext),
  requireEventAdmin,
  asyncHandler(async (req, res) => {
    const ctx = eventContext(req);
    const existing = await prisma.eventUpdate.findFirst({
      where: { id: req.params.updateId as string, eventId: ctx.event.id },
    });
    if (!existing) throw notFound("That update does not exist in this event.");

    await prisma.eventUpdate.delete({ where: { id: existing.id } });
    await recordAudit({
      action: AuditAction.EVENT_UPDATE_DELETED,
      eventId: ctx.event.id,
      actorId: ctx.user?.id ?? null,
      targetType: "event_update",
      targetId: existing.id,
      summary: `Update deleted: ${existing.title}`,
      ipHash: req.ipHash,
    });

    res.status(204).end();
  }),
);

export default router;
