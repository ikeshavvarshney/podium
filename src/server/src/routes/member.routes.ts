import { EventRole } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { asyncHandler } from "../lib/async-handler.js";
import { badRequest, conflict, notFound } from "../lib/errors.js";
import { requireAuth } from "../middleware/auth.js";
import {
  eventContext,
  loadEventContext,
  requireEventAdmin,
} from "../middleware/event-context.js";
import { validate } from "../middleware/validate.js";
import { AuditAction, recordAudit } from "../services/audit.service.js";

const router: Router = Router({ mergeParams: true });

const grantSchema = z.object({
  email: z.string().trim().email(),
  role: z.nativeEnum(EventRole),
  /** Track ids a judge is restricted to. Empty means every track. */
  trackScope: z.array(z.string().uuid()).max(50).optional(),
});

const memberQuerySchema = z.object({
  role: z.nativeEnum(EventRole).optional(),
});

router.get(
  "/",
  requireAuth,
  asyncHandler(loadEventContext),
  requireEventAdmin,
  validate({ query: memberQuerySchema }),
  asyncHandler(async (req, res) => {
    const ctx = eventContext(req);
    const members = await prisma.eventMembership.findMany({
      where: {
        eventId: ctx.event.id,
        ...(req.query.role ? { role: req.query.role as EventRole } : {}),
      },
      include: {
        user: { select: { id: true, name: true, email: true, org: true, avatarHue: true } },
      },
      orderBy: { createdAt: "asc" },
    });
    res.json(members);
  }),
);

router.post(
  "/",
  requireAuth,
  asyncHandler(loadEventContext),
  requireEventAdmin,
  validate({ body: grantSchema }),
  asyncHandler(async (req, res) => {
    const ctx = eventContext(req);
    const email = String(req.body.email).toLowerCase();

    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true, name: true },
    });
    if (!user) throw notFound("No account exists with that email address.");

    const trackScope: string[] = req.body.trackScope ?? [];
    if (trackScope.length > 0) {
      const count = await prisma.track.count({
        where: { id: { in: trackScope }, eventId: ctx.event.id },
      });
      if (count !== trackScope.length) {
        throw badRequest("One or more tracks do not belong to this event.");
      }
    }

    const existing = await prisma.eventMembership.findUnique({
      where: {
        eventId_userId_role: { eventId: ctx.event.id, userId: user.id, role: req.body.role },
      },
    });
    if (existing) throw conflict("That account already holds this role in this event.");

    const membership = await prisma.eventMembership.create({
      data: {
        eventId: ctx.event.id,
        userId: user.id,
        role: req.body.role,
        trackScope,
        invitedById: ctx.user?.id ?? null,
        acceptedAt: new Date(),
      },
      include: { user: { select: { id: true, name: true, email: true } } },
    });

    await recordAudit({
      action:
        req.body.role === EventRole.JUDGE ? AuditAction.JUDGE_INVITED : AuditAction.ROLE_GRANTED,
      eventId: ctx.event.id,
      actorId: ctx.user?.id ?? null,
      targetType: "event_membership",
      targetId: membership.id,
      summary: `${user.name} granted ${req.body.role} on "${ctx.event.name}"`,
      metadata: { role: req.body.role, trackScope },
      ipHash: req.ipHash,
    });

    res.status(201).json(membership);
  }),
);

router.patch(
  "/:membershipId",
  requireAuth,
  asyncHandler(loadEventContext),
  requireEventAdmin,
  validate({ body: z.object({ trackScope: z.array(z.string().uuid()).max(50) }) }),
  asyncHandler(async (req, res) => {
    const ctx = eventContext(req);
    const existing = await prisma.eventMembership.findFirst({
      where: { id: req.params.membershipId as string, eventId: ctx.event.id },
    });
    if (!existing) throw notFound("Membership not found.");

    const trackScope: string[] = req.body.trackScope;
    if (trackScope.length > 0) {
      const count = await prisma.track.count({
        where: { id: { in: trackScope }, eventId: ctx.event.id },
      });
      if (count !== trackScope.length) {
        throw badRequest("One or more tracks do not belong to this event.");
      }
    }

    const membership = await prisma.eventMembership.update({
      where: { id: existing.id },
      data: { trackScope },
    });
    await recordAudit({
      action: AuditAction.ROLE_GRANTED,
      eventId: ctx.event.id,
      actorId: ctx.user?.id ?? null,
      targetType: "event_membership",
      targetId: membership.id,
      summary: `Track scope updated for a ${membership.role} on "${ctx.event.name}"`,
      metadata: { trackScope },
      ipHash: req.ipHash,
    });
    res.json(membership);
  }),
);

router.delete(
  "/:membershipId",
  requireAuth,
  asyncHandler(loadEventContext),
  requireEventAdmin,
  asyncHandler(async (req, res) => {
    const ctx = eventContext(req);
    const membership = await prisma.eventMembership.findFirst({
      where: { id: req.params.membershipId as string, eventId: ctx.event.id },
      include: { user: { select: { name: true } } },
    });
    if (!membership) throw notFound("Membership not found.");

    // The owner must never be able to lock themselves out of their own event.
    if (membership.userId === ctx.event.ownerId && membership.role === EventRole.ADMIN) {
      throw badRequest("The event owner's admin role cannot be revoked.");
    }

    await prisma.eventMembership.delete({ where: { id: membership.id } });
    await recordAudit({
      action: AuditAction.ROLE_REVOKED,
      eventId: ctx.event.id,
      actorId: ctx.user?.id ?? null,
      targetType: "event_membership",
      targetId: membership.id,
      summary: `${membership.user.name} lost ${membership.role} on "${ctx.event.name}"`,
      metadata: { role: membership.role },
      ipHash: req.ipHash,
    });
    res.status(204).end();
  }),
);

export default router;
