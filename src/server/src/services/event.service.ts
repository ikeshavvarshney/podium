import {
  EventMode,
  EventRole,
  EventStatus,
  EventVisibility,
  Experience,
  Prisma,
  QuestionStage,
  SubmissionStatus,
} from "@prisma/client";
import { prisma } from "../db.js";
import { badRequest, conflict, forbidden, notFound } from "../lib/errors.js";
import type { AuthUser } from "../middleware/auth.js";
import { AuditAction, recordAudit } from "./audit.service.js";
import type { EventContext } from "./authorization.service.js";

export interface EventTimeline {
  registrationOpensAt?: Date | null;
  registrationClosesAt?: Date | null;
  submissionsOpenAt?: Date | null;
  submissionDeadline?: Date | null;
  judgingOpensAt?: Date | null;
  judgingClosesAt?: Date | null;
  votingOpensAt?: Date | null;
  votingClosesAt?: Date | null;
}

export interface CreateEventInput extends EventTimeline {
  name: string;
  slug?: string;
  tagline?: string;
  description?: string;
  themeTags?: string[];
  visibility?: EventVisibility;
  timezone?: string;
  minTeamSize?: number;
  maxTeamSize?: number;
  eligibility?: string;
  reviewsPerSubmission?: number;
  mode?: EventMode;
  place?: string | null;
}

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

const ORDERED_DATES: Array<[keyof EventTimeline, keyof EventTimeline]> = [
  ["registrationOpensAt", "registrationClosesAt"],
  ["submissionsOpenAt", "submissionDeadline"],
  ["judgingOpensAt", "judgingClosesAt"],
  ["votingOpensAt", "votingClosesAt"],
];

export function assertTimelineCoherent(timeline: EventTimeline): void {
  for (const [startKey, endKey] of ORDERED_DATES) {
    const start = timeline[startKey];
    const end = timeline[endKey];
    if (start && end && start.getTime() > end.getTime()) {
      throw badRequest(`${String(startKey)} must not be after ${String(endKey)}.`);
    }
  }
}

/** Lowercase words joined by single hyphens: the part of the event link after /events/. */
const SLUG_FORMAT = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** Paths the web client or the API already use under /events/. */
const RESERVED_SLUGS = new Set(["new", "slug-availability"]);

/** Why a chosen link cannot be used, or null if its shape is fine. */
export function slugProblem(slug: string): string | null {
  if (slug.length < 3 || slug.length > 60) return "An event link is 3 to 60 characters.";
  if (!SLUG_FORMAT.test(slug)) {
    return "Use lowercase letters, numbers and single hyphens, with no hyphen at either end.";
  }
  // Events are addressed by id or by link, so a link shaped like an id would be ambiguous.
  if (UUID_SHAPE.test(slug)) return "An event link cannot look like an event id.";
  if (RESERVED_SLUGS.has(slug)) return "That link is reserved.";
  return null;
}

export interface SlugCheck {
  slug: string;
  available: boolean;
  reason?: string;
  suggestion?: string;
}

/** Whether an organizer may claim this link. `exceptEventId` lets an event keep its own. */
export async function checkSlug(slug: string, exceptEventId?: string): Promise<SlugCheck> {
  const problem = slugProblem(slug);
  if (problem) return { slug, available: false, reason: problem };
  const taken = await prisma.event.findUnique({ where: { slug }, select: { id: true } });
  if (!taken || taken.id === exceptEventId) return { slug, available: true };
  return { slug, available: false, reason: "Another event already uses this link.", suggestion: await uniqueSlug(slug) };
}

/** A link the organizer typed is used exactly as typed, or refused; it is never quietly changed. */
async function claimSlug(slug: string, exceptEventId?: string): Promise<string> {
  const check = await checkSlug(slug, exceptEventId);
  if (check.available) return slug;
  if (check.suggestion) throw conflict(check.reason!, { slug: check.reason, suggestion: check.suggestion });
  throw badRequest(check.reason!, { slug: check.reason });
}

async function uniqueSlug(desired: string): Promise<string> {
  const base = slugify(desired) || "event";
  let candidate = base;
  for (let n = 2; n < 500; n += 1) {
    const taken = await prisma.event.findUnique({
      where: { slug: candidate },
      select: { id: true },
    });
    if (!taken) return candidate;
    candidate = `${base}-${n}`;
  }
  throw conflict("Could not allocate a unique event slug.");
}

export async function createEvent(user: AuthUser, input: CreateEventInput, ipHash?: string) {
  if (!user.isOrganizer && !user.isSuperAdmin) {
    throw forbidden("An organizer account is required to create events.");
  }
  assertTimelineCoherent(input);

  const event = await prisma.event.create({
    data: {
      slug: input.slug ? await claimSlug(input.slug) : await uniqueSlug(input.name),
      name: input.name.trim(),
      tagline: input.tagline?.trim() || null,
      description: input.description?.trim() || null,
      themeTags: input.themeTags ?? [],
      visibility: input.visibility ?? EventVisibility.PUBLIC,
      timezone: input.timezone ?? "UTC",
      minTeamSize: input.minTeamSize ?? 1,
      maxTeamSize: input.maxTeamSize ?? 4,
      eligibility: input.eligibility ?? "All",
      reviewsPerSubmission: input.reviewsPerSubmission ?? 3,
      mode: input.mode ?? EventMode.HYBRID,
      place: input.place?.trim() || null,
      ownerId: user.id,
      registrationOpensAt: input.registrationOpensAt ?? null,
      registrationClosesAt: input.registrationClosesAt ?? null,
      submissionsOpenAt: input.submissionsOpenAt ?? null,
      submissionDeadline: input.submissionDeadline ?? null,
      judgingOpensAt: input.judgingOpensAt ?? null,
      judgingClosesAt: input.judgingClosesAt ?? null,
      votingOpensAt: input.votingOpensAt ?? null,
      votingClosesAt: input.votingClosesAt ?? null,
      memberships: {
        create: { userId: user.id, role: EventRole.ADMIN, acceptedAt: new Date() },
      },
      votingConfig: { create: {} },
    },
  });

  await recordAudit({
    action: AuditAction.EVENT_CREATED,
    eventId: event.id,
    actorId: user.id,
    targetType: "event",
    targetId: event.id,
    summary: `${user.name} created event "${event.name}"`,
    ipHash,
  });

  return event;
}

export async function updateEvent(
  ctx: EventContext,
  input: Partial<CreateEventInput> & { status?: EventStatus },
  ipHash?: string,
) {
  // `null` clears a window; only a key that was left out keeps the stored value.
  const pick = <K extends keyof EventTimeline>(key: K): EventTimeline[K] =>
    input[key] !== undefined ? (input[key] as EventTimeline[K]) : ctx.event[key];
  const merged: EventTimeline = {
    registrationOpensAt: pick("registrationOpensAt"),
    registrationClosesAt: pick("registrationClosesAt"),
    submissionsOpenAt: pick("submissionsOpenAt"),
    submissionDeadline: pick("submissionDeadline"),
    judgingOpensAt: pick("judgingOpensAt"),
    judgingClosesAt: pick("judgingClosesAt"),
    votingOpensAt: pick("votingOpensAt"),
    votingClosesAt: pick("votingClosesAt"),
  };
  assertTimelineCoherent(merged);

  const data: Prisma.EventUpdateInput = { ...merged };
  if (input.name !== undefined) data.name = input.name.trim();
  if (input.tagline !== undefined) data.tagline = input.tagline?.trim() || null;
  if (input.description !== undefined) data.description = input.description?.trim() || null;
  if (input.themeTags !== undefined) data.themeTags = input.themeTags;
  if (input.visibility !== undefined) data.visibility = input.visibility;
  if (input.timezone !== undefined) data.timezone = input.timezone;
  if (input.minTeamSize !== undefined) data.minTeamSize = input.minTeamSize;
  if (input.maxTeamSize !== undefined) data.maxTeamSize = input.maxTeamSize;
  if (input.eligibility !== undefined) data.eligibility = input.eligibility;
  if (input.mode !== undefined) data.mode = input.mode;
  if (input.place !== undefined) data.place = input.place?.trim() || null;
  if (input.reviewsPerSubmission !== undefined) {
    data.reviewsPerSubmission = input.reviewsPerSubmission;
  }
  if (input.slug !== undefined && input.slug !== ctx.event.slug) {
    data.slug = await claimSlug(input.slug, ctx.event.id);
  }

  const statusChanged = input.status !== undefined && input.status !== ctx.event.status;
  if (input.status !== undefined) data.status = input.status;

  const updated = await prisma.event.update({ where: { id: ctx.event.id }, data });

  await recordAudit({
    action: statusChanged ? AuditAction.EVENT_STATUS_CHANGED : AuditAction.EVENT_UPDATED,
    eventId: updated.id,
    actorId: ctx.user?.id ?? null,
    targetType: "event",
    targetId: updated.id,
    summary: statusChanged
      ? `Event status changed from ${ctx.event.status} to ${updated.status}`
      : `Event "${updated.name}" updated`,
    metadata: statusChanged ? { from: ctx.event.status, to: updated.status } : {},
    ipHash,
  });

  return updated;
}

export interface ListEventsQuery {
  q?: string;
  status?: EventStatus;
  theme?: string;
  mode?: EventMode;
  eligibility?: string;
  sort?: "recent" | "name" | "deadline";
  take?: number;
  skip?: number;
}

/** Public discovery. Never returns draft or private events. */
export async function listPublicEvents(query: ListEventsQuery) {
  const where: Prisma.EventWhereInput = {
    visibility: EventVisibility.PUBLIC,
    status: query.status ? query.status : { not: EventStatus.DRAFT },
  };
  if (query.q) {
    where.OR = [
      { name: { contains: query.q, mode: "insensitive" } },
      { tagline: { contains: query.q, mode: "insensitive" } },
      { description: { contains: query.q, mode: "insensitive" } },
    ];
  }
  if (query.theme) where.themeTags = { has: query.theme };
  if (query.mode) where.mode = query.mode;
  if (query.eligibility) where.eligibility = query.eligibility;

  const orderBy: Prisma.EventOrderByWithRelationInput =
    query.sort === "name"
      ? { name: "asc" }
      : query.sort === "deadline"
        ? { submissionDeadline: "asc" }
        : { createdAt: "desc" };

  const take = Math.min(query.take ?? 24, 100);
  const skip = query.skip ?? 0;

  const [items, total] = await Promise.all([
    prisma.event.findMany({
      where,
      orderBy,
      take,
      skip,
      include: {
        prizes: { select: { amountCents: true, currency: true } },
        owner: { select: { name: true, org: true } },
        _count: { select: publicCounts },
      },
    }),
    prisma.event.count({ where }),
  ]);

  // The prize pool is the sum of the event's prizes, so the card can never
  // disagree with the prize list on the event page.
  return {
    items: items.map(({ prizes, ...event }) => ({
      ...event,
      prizePoolCents: prizes.reduce((sum, p) => sum + (p.amountCents ?? 0), 0),
      currency: prizes[0]?.currency ?? "USD",
    })),
    total,
    take,
    skip,
  };
}

/**
 * The numbers an event shows the public. "Registered" is participants, not every role
 * holder, and "submissions" is what is in the gallery: a draft is nobody's business yet.
 */
const publicCounts = {
  submissions: { where: { status: SubmissionStatus.SUBMITTED } },
  memberships: { where: { role: EventRole.PARTICIPANT } },
  teams: true,
} as const;

export async function getEventDetail(ctx: EventContext) {
  const event = await prisma.event.findUnique({
    where: { id: ctx.event.id },
    include: {
      tracks: { orderBy: { position: "asc" } },
      prizes: { orderBy: { position: "asc" }, include: { track: { select: { id: true, name: true } } } },
      customQuestions: { orderBy: { position: "asc" } },
      owner: { select: { id: true, name: true, org: true } },
      _count: { select: publicCounts },
    },
  });
  if (!event) throw notFound("Event not found.");

  return {
    ...event,
    viewer: {
      roles: [...ctx.roles],
      isOwner: ctx.isOwner,
      isEventAdmin: ctx.isEventAdmin,
      isJudge: ctx.isJudge,
      isParticipant: ctx.isParticipant,
    },
  };
}

/** Self-service registration for an event: grants the PARTICIPANT role. */
export interface RegistrationInput {
  currentRole?: string | null;
  experience?: Experience | null;
  skills?: string[];
  trackId?: string | null;
  shareProfile?: boolean;
  acceptRules?: boolean;
  acceptConduct?: boolean;
  answers?: Array<{ questionId: string; value: string }>;
}

export async function registerForEvent(
  ctx: EventContext,
  user: AuthUser,
  input: RegistrationInput = {},
  ipHash?: string,
) {
  const now = new Date();
  const { event } = ctx;

  if (event.status === EventStatus.DRAFT) {
    throw forbidden("This event is not open yet.");
  }
  if (event.registrationOpensAt && now < event.registrationOpensAt) {
    throw forbidden("Registration has not opened yet.");
  }
  if (event.registrationClosesAt && now > event.registrationClosesAt) {
    throw forbidden("Registration for this event has closed.");
  }
  if (ctx.roles.has(EventRole.PARTICIPANT)) {
    throw conflict("You are already registered for this event.");
  }

  // Required registration questions are enforced here, not just in the form.
  const questions = await prisma.customQuestion.findMany({
    where: { eventId: event.id, stage: QuestionStage.REGISTRATION },
    select: { id: true, prompt: true, required: true },
  });
  const answers = new Map((input.answers ?? []).map((a) => [a.questionId, a.value.trim()]));
  for (const id of answers.keys()) {
    if (!questions.some((q) => q.id === id)) {
      throw badRequest("One of those answers is for a question this event does not ask.");
    }
  }
  const missing = questions.filter((q) => q.required && !answers.get(q.id));
  if (missing.length > 0) {
    throw badRequest(`Answer the required question: ${missing[0]!.prompt}`);
  }

  const detailed =
    input.acceptRules !== undefined ||
    input.acceptConduct !== undefined ||
    questions.length > 0;
  if (detailed && (!input.acceptRules || !input.acceptConduct)) {
    throw badRequest("Accept the rules and the code of conduct to register.");
  }

  if (input.trackId) {
    const track = await prisma.track.findFirst({ where: { id: input.trackId, eventId: event.id } });
    if (!track) throw badRequest("That track does not belong to this event.");
  }

  const membership = await prisma.$transaction(async (tx) => {
    const created = await tx.eventMembership.create({
      data: {
        eventId: event.id,
        userId: user.id,
        role: EventRole.PARTICIPANT,
        acceptedAt: now,
      },
    });
    if (detailed) {
      await tx.registration.create({
        data: {
          eventId: event.id,
          userId: user.id,
          currentRole: input.currentRole?.trim() || null,
          experience: input.experience ?? null,
          skills: input.skills ?? [],
          trackId: input.trackId ?? null,
          shareProfile: input.shareProfile ?? false,
          answers: Object.fromEntries(answers),
          rulesAcceptedAt: now,
          conductAcceptedAt: now,
        },
      });
    }
    return created;
  });

  await recordAudit({
    action: AuditAction.MEMBER_REGISTERED,
    eventId: event.id,
    actorId: user.id,
    targetType: "event_membership",
    targetId: membership.id,
    summary: `${user.name} registered for "${event.name}"`,
    ipHash,
  });

  return membership;
}
