import type { Event, EventMembership } from "@prisma/client";
import { EventRole } from "@prisma/client";
import { prisma } from "../db.js";
import { forbidden, notFound } from "../lib/errors.js";
import type { AuthUser } from "../middleware/auth.js";

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
  isJudge: boolean;
  isParticipant: boolean;
  /** Empty array means the judge is not track-restricted. */
  judgeTrackScope: string[];
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

  const judgeMembership = memberships.find((m) => m.role === EventRole.JUDGE);

  return {
    event,
    user,
    memberships,
    roles,
    isOwner,
    isEventAdmin,
    isJudge: roles.has(EventRole.JUDGE),
    isParticipant: roles.has(EventRole.PARTICIPANT),
    judgeTrackScope: judgeMembership?.trackScope ?? [],
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

export function assertJudge(ctx: EventContext): void {
  if (!ctx.isJudge) throw forbidden("You are not a judge on this event.");
}

