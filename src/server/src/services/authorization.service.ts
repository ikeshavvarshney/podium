import type { Event, EventMembership } from "@prisma/client";
import { EventRole } from "@prisma/client";
import { prisma } from "../db.js";
import { forbidden, notFound } from "../lib/errors.js";
import type { AuthUser } from "../middleware/auth.js";
import { EVENT_AREAS, FULL_ACCESS, isEventArea, type EventArea } from "../lib/permissions.js";

/**
 * Everything a request is allowed to do inside one event, derived from the
 * database. Nothing here is ever read from the request body or query string.
 */
export interface EventContext {
  event: Event;
  user: AuthUser | null;
  memberships: EventMembership[];
  roles: Set<EventRole>;
  isOwner: boolean;
  isEventAdmin: boolean;
  /** Organizer areas this caller may use; every area for an owner, a super admin or a full-access admin. */
  permissions: Set<EventArea>;
  fullAccess: boolean;
  isJudge: boolean;
  isParticipant: boolean;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function findEventByIdOrSlug(idOrSlug: string): Promise<Event | null> {
  if (UUID_RE.test(idOrSlug)) {
    return prisma.event.findUnique({ where: { id: idOrSlug } });
  }
  return prisma.event.findUnique({ where: { slug: idOrSlug } });
}

export async function buildEventContext(
  idOrSlug: string,
  user: AuthUser | null,
): Promise<EventContext> {
  const event = await findEventByIdOrSlug(idOrSlug);
  if (!event) throw notFound("Event not found.");

  const memberships = user
    ? await prisma.eventMembership.findMany({
        where: { eventId: event.id, userId: user.id },
      })
    : [];

  const roles = new Set(memberships.map((m) => m.role));
  const isOwner = !!user && event.ownerId === user.id;
  const isSuperAdmin = !!user?.isSuperAdmin;
  const isEventAdmin = isOwner || isSuperAdmin || roles.has(EventRole.ADMIN);

  const granted = memberships.find((m) => m.role === EventRole.ADMIN)?.permissions ?? [];
  const fullAccess = isOwner || isSuperAdmin || granted.includes(FULL_ACCESS);
  const permissions = new Set<EventArea>(fullAccess ? EVENT_AREAS : granted.filter(isEventArea));

  return {
    event,
    user,
    memberships,
    roles,
    isOwner,
    isEventAdmin,
    permissions,
    fullAccess,
    isJudge: roles.has(EventRole.JUDGE),
    isParticipant: roles.has(EventRole.PARTICIPANT),
  };
}

/**
 * A private event, or a draft, is invisible to anyone without a membership. Returning 404
 * rather than 403 keeps the existence of an unpublished event from leaking.
 */
export function assertEventVisible(ctx: EventContext): void {
  if (ctx.event.visibility !== "PRIVATE" && ctx.event.status !== "DRAFT") return;
  if (ctx.isEventAdmin || ctx.memberships.length > 0) return;
  throw notFound("Event not found.");
}

export function assertEventAdmin(ctx: EventContext): void {
  if (!ctx.isEventAdmin) throw forbidden("Organizer or event admin access is required.");
}

export function can(ctx: EventContext, area: EventArea): boolean {
  return ctx.permissions.has(area);
}

export function assertPermission(ctx: EventContext, areas: EventArea[]): void {
  if (!ctx.isEventAdmin) throw forbidden("Organizer or event admin access is required.");
  if (!areas.some((a) => ctx.permissions.has(a))) {
    throw forbidden("Your admin access to this event does not include this.");
  }
}

export function assertFullAccess(ctx: EventContext): void {
  if (!ctx.fullAccess) throw forbidden("Only an organizer with full access can manage admins.");
}

export function assertJudge(ctx: EventContext): void {
  if (!ctx.isJudge) throw forbidden("You are not a judge on this event.");
}

