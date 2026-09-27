import { RoundKind } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { asyncHandler } from "../lib/async-handler.js";
import { badRequest, notFound } from "../lib/errors.js";
import { requireAuth } from "../middleware/auth.js";
import { eventContext, loadEventContext, requireEventAdmin } from "../middleware/event-context.js";
import { writeRateLimit } from "../middleware/rate-limit.js";
import { validate } from "../middleware/validate.js";
import { AuditAction, recordAudit } from "../services/audit.service.js";

/**
 * Rounds and FAQ entries: organizer-authored, public to anyone who may see the
 * event. Neither grants anything; they describe the event.
 */

const roundSchema = z.object({
  name: z.string().trim().min(1, "A round needs a name.").max(80),
  kind: z.nativeEnum(RoundKind).optional(),
  description: z.string().trim().max(1000).nullish(),
  position: z.number().int().min(0).max(99).optional(),
  opensAt: z.coerce.date().nullish(),
  closesAt: z.coerce.date().nullish(),
  advances: z.number().int().min(1).max(10000).nullish(),
});

const faqSchema = z.object({
  question: z.string().trim().min(1, "A question is required.").max(300),
  answer: z.string().trim().min(1, "An answer is required.").max(4000),
  position: z.number().int().min(0).max(999).optional(),
});

function assertWindow(opensAt?: Date | null, closesAt?: Date | null) {
  if (opensAt && closesAt && opensAt >= closesAt) {
    throw badRequest("A round must close after it opens.");
  }
}

export const roundRoutes: Router = Router({ mergeParams: true });

roundRoutes.get(
  "/",
  asyncHandler(loadEventContext),
  asyncHandler(async (req, res) => {
    res.json(
      await prisma.round.findMany({
        where: { eventId: eventContext(req).event.id },
        orderBy: [{ position: "asc" }, { opensAt: "asc" }],
      }),
    );
  }),
);

roundRoutes.post(
  "/",
  requireAuth,
  asyncHandler(loadEventContext),
  requireEventAdmin,
  writeRateLimit,
  validate({ body: roundSchema }),
  asyncHandler(async (req, res) => {
    const ctx = eventContext(req);
    assertWindow(req.body.opensAt, req.body.closesAt);
    const count = await prisma.round.count({ where: { eventId: ctx.event.id } });
    const round = await prisma.round.create({
      data: { ...req.body, eventId: ctx.event.id, position: req.body.position ?? count },
    });
    await recordAudit({
      action: AuditAction.ROUND_CHANGED,
      eventId: ctx.event.id,
      actorId: ctx.user?.id ?? null,
      targetType: "round",
      targetId: round.id,
      summary: `Round created: ${round.name}`,
      ipHash: req.ipHash,
    });
    res.status(201).json(round);
  }),
);

roundRoutes.patch(
  "/:roundId",
  requireAuth,
  asyncHandler(loadEventContext),
  requireEventAdmin,
  validate({ body: roundSchema.partial() }),
  asyncHandler(async (req, res) => {
    const ctx = eventContext(req);
    const existing = await prisma.round.findFirst({
      where: { id: req.params.roundId as string, eventId: ctx.event.id },
    });
    if (!existing) throw notFound("That round does not exist in this event.");
    assertWindow(
      req.body.opensAt === undefined ? existing.opensAt : req.body.opensAt,
      req.body.closesAt === undefined ? existing.closesAt : req.body.closesAt,
    );
    const round = await prisma.round.update({ where: { id: existing.id }, data: req.body });
    await recordAudit({
      action: AuditAction.ROUND_CHANGED,
      eventId: ctx.event.id,
      actorId: ctx.user?.id ?? null,
      targetType: "round",
      targetId: round.id,
      summary: `Round updated: ${round.name}`,
      ipHash: req.ipHash,
    });
    res.json(round);
  }),
);

roundRoutes.delete(
  "/:roundId",
  requireAuth,
  asyncHandler(loadEventContext),
  requireEventAdmin,
  asyncHandler(async (req, res) => {
    const ctx = eventContext(req);
    const existing = await prisma.round.findFirst({
      where: { id: req.params.roundId as string, eventId: ctx.event.id },
    });
    if (!existing) throw notFound("That round does not exist in this event.");
    await prisma.round.delete({ where: { id: existing.id } });
    await recordAudit({
      action: AuditAction.ROUND_CHANGED,
      eventId: ctx.event.id,
      actorId: ctx.user?.id ?? null,
      targetType: "round",
      targetId: existing.id,
      summary: `Round deleted: ${existing.name}`,
      ipHash: req.ipHash,
    });
    res.status(204).end();
  }),
);

export const faqRoutes: Router = Router({ mergeParams: true });

faqRoutes.get(
  "/",
  asyncHandler(loadEventContext),
  asyncHandler(async (req, res) => {
    res.json(
      await prisma.faqItem.findMany({
        where: { eventId: eventContext(req).event.id },
        orderBy: { position: "asc" },
      }),
    );
  }),
);

faqRoutes.post(
  "/",
  requireAuth,
  asyncHandler(loadEventContext),
  requireEventAdmin,
  writeRateLimit,
  validate({ body: faqSchema }),
  asyncHandler(async (req, res) => {
    const ctx = eventContext(req);
    const count = await prisma.faqItem.count({ where: { eventId: ctx.event.id } });
    const item = await prisma.faqItem.create({
      data: { ...req.body, eventId: ctx.event.id, position: req.body.position ?? count },
    });
    await recordAudit({
      action: AuditAction.FAQ_CHANGED,
      eventId: ctx.event.id,
      actorId: ctx.user?.id ?? null,
      targetType: "faq",
      targetId: item.id,
      summary: `FAQ entry added: ${item.question}`,
      ipHash: req.ipHash,
    });
    res.status(201).json(item);
  }),
);

faqRoutes.patch(
  "/:faqId",
  requireAuth,
  asyncHandler(loadEventContext),
  requireEventAdmin,
  validate({ body: faqSchema.partial() }),
  asyncHandler(async (req, res) => {
    const ctx = eventContext(req);
    const existing = await prisma.faqItem.findFirst({
      where: { id: req.params.faqId as string, eventId: ctx.event.id },
    });
    if (!existing) throw notFound("That entry does not exist in this event.");
    const item = await prisma.faqItem.update({ where: { id: existing.id }, data: req.body });
    await recordAudit({
      action: AuditAction.FAQ_CHANGED,
      eventId: ctx.event.id,
      actorId: ctx.user?.id ?? null,
      targetType: "faq",
      targetId: item.id,
      summary: `FAQ entry edited: ${item.question}`,
      ipHash: req.ipHash,
    });
    res.json(item);
  }),
);

faqRoutes.delete(
  "/:faqId",
  requireAuth,
  asyncHandler(loadEventContext),
  requireEventAdmin,
  asyncHandler(async (req, res) => {
    const ctx = eventContext(req);
    const existing = await prisma.faqItem.findFirst({
      where: { id: req.params.faqId as string, eventId: ctx.event.id },
    });
    if (!existing) throw notFound("That entry does not exist in this event.");
    await prisma.faqItem.delete({ where: { id: existing.id } });
    await recordAudit({
      action: AuditAction.FAQ_CHANGED,
      eventId: ctx.event.id,
      actorId: ctx.user?.id ?? null,
      targetType: "faq",
      targetId: existing.id,
      summary: `FAQ entry deleted: ${existing.question}`,
      ipHash: req.ipHash,
    });
    res.status(204).end();
  }),
);
