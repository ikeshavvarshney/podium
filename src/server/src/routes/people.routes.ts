import { PersonKind } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { asyncHandler } from "../lib/async-handler.js";
import { notFound } from "../lib/errors.js";
import { requireAuth } from "../middleware/auth.js";
import { eventContext, loadEventContext, requirePermission } from "../middleware/event-context.js";
import { writeRateLimit } from "../middleware/rate-limit.js";
import { validate } from "../middleware/validate.js";
import { AuditAction, recordAudit } from "../services/audit.service.js";

/**
 * Speakers, mentors and partner organizations: organizer-authored, public,
 * carrying no account and no capability. Shown on the event's People tab.
 */

const personSchema = z.object({
  kind: z.nativeEnum(PersonKind).optional(),
  name: z.string().trim().min(1, "A name is required.").max(120),
  role: z.string().trim().min(1, "A role is required.").max(160),
  org: z.string().trim().max(160).nullish(),
  position: z.number().int().min(0).max(999).optional(),
});

const partnerSchema = z.object({
  name: z.string().trim().min(1, "A name is required.").max(160),
  tier: z.string().trim().min(1, "A tier label is required.").max(80),
  position: z.number().int().min(0).max(999).optional(),
});

export const personRoutes: Router = Router({ mergeParams: true });

personRoutes.get(
  "/",
  asyncHandler(loadEventContext),
  asyncHandler(async (req, res) => {
    res.json(
      await prisma.eventPerson.findMany({
        where: { eventId: eventContext(req).event.id },
        orderBy: { position: "asc" },
      }),
    );
  }),
);

personRoutes.post(
  "/",
  requireAuth,
  asyncHandler(loadEventContext),
  requirePermission("SETTINGS"),
  writeRateLimit,
  validate({ body: personSchema }),
  asyncHandler(async (req, res) => {
    const ctx = eventContext(req);
    const count = await prisma.eventPerson.count({ where: { eventId: ctx.event.id } });
    const person = await prisma.eventPerson.create({
      data: { ...req.body, eventId: ctx.event.id, position: req.body.position ?? count },
    });
    await recordAudit({
      action: AuditAction.PERSON_CHANGED,
      eventId: ctx.event.id,
      actorId: ctx.user?.id ?? null,
      targetType: "event_person",
      targetId: person.id,
      summary: `Added to People: ${person.name}`,
      ipHash: req.ipHash,
    });
    res.status(201).json(person);
  }),
);

personRoutes.patch(
  "/:personId",
  requireAuth,
  asyncHandler(loadEventContext),
  requirePermission("SETTINGS"),
  validate({ body: personSchema.partial() }),
  asyncHandler(async (req, res) => {
    const ctx = eventContext(req);
    const existing = await prisma.eventPerson.findFirst({
      where: { id: req.params.personId as string, eventId: ctx.event.id },
    });
    if (!existing) throw notFound("That person does not exist in this event.");
    res.json(await prisma.eventPerson.update({ where: { id: existing.id }, data: req.body }));
  }),
);

personRoutes.delete(
  "/:personId",
  requireAuth,
  asyncHandler(loadEventContext),
  requirePermission("SETTINGS"),
  asyncHandler(async (req, res) => {
    const ctx = eventContext(req);
    const existing = await prisma.eventPerson.findFirst({
      where: { id: req.params.personId as string, eventId: ctx.event.id },
    });
    if (!existing) throw notFound("That person does not exist in this event.");
    await prisma.eventPerson.delete({ where: { id: existing.id } });
    await recordAudit({
      action: AuditAction.PERSON_CHANGED,
      eventId: ctx.event.id,
      actorId: ctx.user?.id ?? null,
      targetType: "event_person",
      targetId: existing.id,
      summary: `Removed from People: ${existing.name}`,
      ipHash: req.ipHash,
    });
    res.status(204).end();
  }),
);

export const partnerRoutes: Router = Router({ mergeParams: true });

partnerRoutes.get(
  "/",
  asyncHandler(loadEventContext),
  asyncHandler(async (req, res) => {
    res.json(
      await prisma.partner.findMany({
        where: { eventId: eventContext(req).event.id },
        orderBy: { position: "asc" },
      }),
    );
  }),
);

partnerRoutes.post(
  "/",
  requireAuth,
  asyncHandler(loadEventContext),
  requirePermission("SETTINGS"),
  writeRateLimit,
  validate({ body: partnerSchema }),
  asyncHandler(async (req, res) => {
    const ctx = eventContext(req);
    const count = await prisma.partner.count({ where: { eventId: ctx.event.id } });
    const partner = await prisma.partner.create({
      data: { ...req.body, eventId: ctx.event.id, position: req.body.position ?? count },
    });
    await recordAudit({
      action: AuditAction.PARTNER_CHANGED,
      eventId: ctx.event.id,
      actorId: ctx.user?.id ?? null,
      targetType: "partner",
      targetId: partner.id,
      summary: `Partner added: ${partner.name}`,
      ipHash: req.ipHash,
    });
    res.status(201).json(partner);
  }),
);

partnerRoutes.patch(
  "/:partnerId",
  requireAuth,
  asyncHandler(loadEventContext),
  requirePermission("SETTINGS"),
  validate({ body: partnerSchema.partial() }),
  asyncHandler(async (req, res) => {
    const ctx = eventContext(req);
    const existing = await prisma.partner.findFirst({
      where: { id: req.params.partnerId as string, eventId: ctx.event.id },
    });
    if (!existing) throw notFound("That partner does not exist in this event.");
    res.json(await prisma.partner.update({ where: { id: existing.id }, data: req.body }));
  }),
);

partnerRoutes.delete(
  "/:partnerId",
  requireAuth,
  asyncHandler(loadEventContext),
  requirePermission("SETTINGS"),
  asyncHandler(async (req, res) => {
    const ctx = eventContext(req);
    const existing = await prisma.partner.findFirst({
      where: { id: req.params.partnerId as string, eventId: ctx.event.id },
    });
    if (!existing) throw notFound("That partner does not exist in this event.");
    await prisma.partner.delete({ where: { id: existing.id } });
    await recordAudit({
      action: AuditAction.PARTNER_CHANGED,
      eventId: ctx.event.id,
      actorId: ctx.user?.id ?? null,
      targetType: "partner",
      targetId: existing.id,
      summary: `Partner removed: ${existing.name}`,
      ipHash: req.ipHash,
    });
    res.status(204).end();
  }),
);
