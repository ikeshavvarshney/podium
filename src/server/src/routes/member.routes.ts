import { EventRole } from "@prisma/client";
import { EVENT_AREAS, FULL_ACCESS } from "../lib/permissions.js";
import { assertFullAccess } from "../services/authorization.service.js";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { asyncHandler } from "../lib/async-handler.js";
import { badRequest, conflict, notFound } from "../lib/errors.js";
import { requireAuth } from "../middleware/auth.js";
import {
  eventContext,
  loadEventContext,
  requirePermission,
} from "../middleware/event-context.js";
import { validate } from "../middleware/validate.js";
import { AuditAction, recordAudit } from "../services/audit.service.js";

const router: Router = Router({ mergeParams: true });

const permissionList = z
  .array(z.enum([FULL_ACCESS, ...EVENT_AREAS] as [string, ...string[]]))
  .max(EVENT_AREAS.length + 1)
  .transform((list) => (list.includes(FULL_ACCESS) ? [FULL_ACCESS] : [...new Set(list)]));

const grantSchema = z.object({
  email: z.string().trim().email(),
  role: z.nativeEnum(EventRole),
  permissions: permissionList.optional(),
});

const memberQuerySchema = z.object({
  role: z.nativeEnum(EventRole).optional(),
});

router.get(
  "/",
  requireAuth,
  asyncHandler(loadEventContext),
  requirePermission("ROLES"),
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
  requirePermission("ROLES"),
  validate({ body: grantSchema }),
  asyncHandler(async (req, res) => {
    const ctx = eventContext(req);
    const email = String(req.body.email).toLowerCase();
    if (req.body.role === EventRole.ADMIN) assertFullAccess(ctx);

    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true, name: true },
    });
    if (!user) throw notFound("No account exists with that email address.");

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
        permissions: req.body.role === EventRole.ADMIN ? (req.body.permissions ?? []) : [],
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
      metadata: { role: req.body.role, permissions: membership.permissions },
      ipHash: req.ipHash,
    });

    res.status(201).json(membership);
  }),
);

router.patch(
  "/:membershipId",
  requireAuth,
  asyncHandler(loadEventContext),
  requirePermission("ROLES"),
  validate({
    body: z.object({ permissions: permissionList }),
  }),
  asyncHandler(async (req, res) => {
    const ctx = eventContext(req);
    const existing = await prisma.eventMembership.findFirst({
      where: { id: req.params.membershipId as string, eventId: ctx.event.id },
    });
    if (!existing) throw notFound("Membership not found.");
    if (existing.role !== EventRole.ADMIN) throw badRequest("Only an admin's access can be limited.");
    assertFullAccess(ctx);
    if (existing.userId === ctx.event.ownerId) throw badRequest("The event owner always has full access.");

    const membership = await prisma.eventMembership.update({
      where: { id: existing.id },
      data: { permissions: req.body.permissions },
    });
    await recordAudit({
      action: AuditAction.ROLE_GRANTED,
      eventId: ctx.event.id,
      actorId: ctx.user?.id ?? null,
      targetType: "event_membership",
      targetId: membership.id,
      summary: `Admin access on "${ctx.event.name}" set to ${membership.permissions.join(", ") || "nothing"}`,
      metadata: { permissions: membership.permissions },
      ipHash: req.ipHash,
    });
    res.json(membership);
  }),
);
router.delete(
  "/:membershipId",
  requireAuth,
  asyncHandler(loadEventContext),
  requirePermission("ROLES"),
  asyncHandler(async (req, res) => {
    const ctx = eventContext(req);
    const membership = await prisma.eventMembership.findFirst({
      where: { id: req.params.membershipId as string, eventId: ctx.event.id },
      include: { user: { select: { name: true } } },
    });
    if (!membership) throw notFound("Membership not found.");
    if (membership.role === EventRole.ADMIN) assertFullAccess(ctx);

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
