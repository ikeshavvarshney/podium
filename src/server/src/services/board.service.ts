import { EventRole, JoinDirection, JoinStatus, TeamRole } from "@prisma/client";
import { prisma } from "../db.js";
import { badRequest, conflict, forbidden, notFound } from "../lib/errors.js";
import type { AuthUser } from "../middleware/auth.js";
import { AuditAction, recordAudit } from "./audit.service.js";
import type { EventContext } from "./authorization.service.js";

/**
 * The team formation board. Teams list what they still need; people without a
 * team list what they want to work on. Requests between the two are private,
 * and nothing changes on either side until the counterparty accepts.
 */

function assertBoardOpen(ctx: EventContext): void {
  const closes = ctx.event.registrationClosesAt;
  if (closes && new Date() > closes) {
    throw forbidden("Team formation has closed for this event.");
  }
}

async function myTeam(eventId: string, userId: string) {
  return prisma.team.findFirst({
    where: { eventId, members: { some: { userId } } },
    include: { members: { select: { userId: true, role: true } } },
  });
}

export async function getBoard(ctx: EventContext) {
  const [teams, seekers] = await Promise.all([
    prisma.team.findMany({
      where: { eventId: ctx.event.id, lookingForMembers: true },
      orderBy: { updatedAt: "desc" },
      include: {
        members: {
          include: { user: { select: { id: true, name: true } } },
          orderBy: { joinedAt: "asc" },
        },
      },
    }),
    prisma.seekerListing.findMany({
      where: { eventId: ctx.event.id, active: true },
      orderBy: { updatedAt: "desc" },
      include: { user: { select: { id: true, name: true, org: true } } },
    }),
  ]);

  // People already on a team are no longer seeking, whatever their listing says.
  const onTeams = new Set(
    (
      await prisma.teamMember.findMany({
        where: { team: { eventId: ctx.event.id }, userId: { in: seekers.map((s) => s.userId) } },
        select: { userId: true },
      })
    ).map((m) => m.userId),
  );

  const tracks = new Map(
    (await prisma.track.findMany({ where: { eventId: ctx.event.id }, select: { id: true, name: true } })).map(
      (t) => [t.id, t],
    ),
  );

  return {
    maxTeamSize: ctx.event.maxTeamSize,
    teams: teams
      .filter((t) => t.members.length < ctx.event.maxTeamSize)
      .map((t) => ({
        kind: "TEAM" as const,
        id: t.id,
        name: t.name,
        pitch: t.pitch,
        needs: t.needs,
        skills: t.skills,
        track: t.boardTrackId ? (tracks.get(t.boardTrackId) ?? null) : null,
        owner: t.members.find((m) => m.role === TeamRole.OWNER)?.user.name ?? null,
        seatsFilled: t.members.length,
      })),
    seekers: seekers
      .filter((s) => !onTeams.has(s.userId))
      .map((s) => ({
        kind: "SEEKER" as const,
        id: s.id,
        userId: s.userId,
        name: s.user.name,
        org: s.user.org,
        pitch: s.pitch,
        skills: s.skills,
        track: s.trackId ? (tracks.get(s.trackId) ?? null) : null,
      })),
  };
}

export interface ListingInput {
  pitch: string;
  needs?: string[];
  skills?: string[];
  trackId?: string | null;
}

/**
 * Posts the caller's listing. A team owner updates their team's listing; a
 * participant without a team posts themselves as looking for one.
 */
export async function postListing(ctx: EventContext, user: AuthUser, input: ListingInput, ipHash?: string) {
  assertBoardOpen(ctx);
  if (!ctx.isParticipant) throw forbidden("Register for this event before posting to the board.");

  if (input.trackId) {
    const track = await prisma.track.findFirst({ where: { id: input.trackId, eventId: ctx.event.id } });
    if (!track) throw badRequest("That track does not belong to this event.");
  }

  const team = await myTeam(ctx.event.id, user.id);
  if (team) {
    if (!team.members.some((m) => m.userId === user.id && m.role === TeamRole.OWNER)) {
      throw forbidden("Only the team owner can edit the team's listing.");
    }
    const updated = await prisma.team.update({
      where: { id: team.id },
      data: {
        pitch: input.pitch,
        needs: input.needs ?? [],
        skills: input.skills ?? [],
        boardTrackId: input.trackId ?? null,
        lookingForMembers: true,
      },
    });
    await recordAudit({
      action: AuditAction.TEAM_UPDATED,
      eventId: ctx.event.id,
      actorId: user.id,
      targetType: "team",
      targetId: team.id,
      summary: `Team "${team.name}" posted a board listing`,
      ipHash,
    });
    return { kind: "TEAM" as const, id: updated.id };
  }

  const listing = await prisma.seekerListing.upsert({
    where: { eventId_userId: { eventId: ctx.event.id, userId: user.id } },
    create: {
      eventId: ctx.event.id,
      userId: user.id,
      pitch: input.pitch,
      skills: input.skills ?? [],
      trackId: input.trackId ?? null,
    },
    update: { pitch: input.pitch, skills: input.skills ?? [], trackId: input.trackId ?? null, active: true },
  });
  return { kind: "SEEKER" as const, id: listing.id };
}

/** "Ask to join": a teamless participant asks a team to take them. */
export async function askToJoin(ctx: EventContext, user: AuthUser, teamId: string, message?: string) {
  assertBoardOpen(ctx);
  if (!ctx.isParticipant) throw forbidden("Register for this event before asking to join a team.");
  if (await myTeam(ctx.event.id, user.id)) throw conflict("You are already on a team for this event.");

  const team = await prisma.team.findFirst({ where: { id: teamId, eventId: ctx.event.id } });
  if (!team) throw notFound("That team is not in this event.");

  const pending = await prisma.joinRequest.findFirst({
    where: { teamId, userId: user.id, status: JoinStatus.PENDING },
  });
  if (pending) throw conflict("You already have a pending request with this team.");

  return prisma.joinRequest.create({
    data: {
      eventId: ctx.event.id,
      teamId,
      userId: user.id,
      direction: JoinDirection.ASK,
      message: message ?? null,
    },
  });
}

/** "Invite to your team": a team owner invites a listed person. */
export async function invitePerson(ctx: EventContext, user: AuthUser, userId: string, message?: string) {
  assertBoardOpen(ctx);
  const team = await myTeam(ctx.event.id, user.id);
  if (!team || !team.members.some((m) => m.userId === user.id && m.role === TeamRole.OWNER)) {
    throw forbidden("Only a team owner can invite people to a team.");
  }
  if (team.members.length >= ctx.event.maxTeamSize) {
    throw conflict(`Your team is full (maximum ${ctx.event.maxTeamSize} members).`);
  }

  const target = await prisma.eventMembership.findFirst({
    where: { eventId: ctx.event.id, userId, role: EventRole.PARTICIPANT },
  });
  if (!target) throw notFound("That person is not registered for this event.");
  if (await myTeam(ctx.event.id, userId)) throw conflict("That person is already on a team.");

  const pending = await prisma.joinRequest.findFirst({
    where: { teamId: team.id, userId, status: JoinStatus.PENDING },
  });
  if (pending) throw conflict("There is already a pending request between your team and that person.");

  return prisma.joinRequest.create({
    data: {
      eventId: ctx.event.id,
      teamId: team.id,
      userId,
      direction: JoinDirection.INVITE,
      message: message ?? null,
    },
  });
}

/** Requests that involve the caller, in both directions. */
export async function myRequests(ctx: EventContext, user: AuthUser) {
  const team = await myTeam(ctx.event.id, user.id);
  const owner = team?.members.some((m) => m.userId === user.id && m.role === TeamRole.OWNER) ?? false;

  const rows = await prisma.joinRequest.findMany({
    where: {
      eventId: ctx.event.id,
      status: JoinStatus.PENDING,
      OR: [{ userId: user.id }, ...(owner && team ? [{ teamId: team.id }] : [])],
    },
    orderBy: { createdAt: "desc" },
    include: {
      team: { select: { id: true, name: true } },
      user: { select: { id: true, name: true } },
    },
  });

  return rows.map((r) => {
    const mine = r.userId === user.id;
    // Who has to act: the team owner answers an ASK, the person answers an INVITE.
    const awaitingMe = r.direction === JoinDirection.ASK ? !mine : mine;
    return { ...r, awaitingMe };
  });
}

/**
 * Accepts or declines a request. Only the counterparty may decide it, and an
 * acceptance goes through the same size and single-team checks as an invite
 * link, inside one transaction.
 */
export async function decideRequest(
  ctx: EventContext,
  user: AuthUser,
  requestId: string,
  accept: boolean,
  ipHash?: string,
) {
  const request = await prisma.joinRequest.findFirst({
    where: { id: requestId, eventId: ctx.event.id },
    include: { team: { include: { members: { select: { userId: true, role: true } } } } },
  });
  if (!request) throw notFound("That request does not exist in this event.");
  if (request.status !== JoinStatus.PENDING) throw conflict("That request has already been decided.");

  const isOwner = request.team.members.some((m) => m.userId === user.id && m.role === TeamRole.OWNER);
  const mayDecide = request.direction === JoinDirection.ASK ? isOwner : request.userId === user.id;
  const mayWithdraw = request.direction === JoinDirection.ASK ? request.userId === user.id : isOwner;

  if (!accept && mayWithdraw && !mayDecide) {
    return prisma.joinRequest.update({
      where: { id: request.id },
      data: { status: JoinStatus.WITHDRAWN, decidedAt: new Date() },
    });
  }
  if (!mayDecide) throw forbidden("Only the other side of this request can answer it.");

  if (!accept) {
    return prisma.joinRequest.update({
      where: { id: request.id },
      data: { status: JoinStatus.DECLINED, decidedAt: new Date() },
    });
  }

  assertBoardOpen(ctx);

  const result = await prisma.$transaction(async (tx) => {
    const existing = await tx.teamMember.findFirst({
      where: { userId: request.userId, team: { eventId: ctx.event.id } },
    });
    if (existing) throw conflict("That person is already on a team for this event.");

    const size = await tx.teamMember.count({ where: { teamId: request.teamId } });
    if (size >= ctx.event.maxTeamSize) {
      throw conflict(`This team is full (maximum ${ctx.event.maxTeamSize} members).`);
    }

    await tx.teamMember.create({
      data: { teamId: request.teamId, userId: request.userId, role: TeamRole.MEMBER },
    });
    await tx.seekerListing.updateMany({
      where: { eventId: ctx.event.id, userId: request.userId },
      data: { active: false },
    });
    // Every other open request for this person is moot now.
    await tx.joinRequest.updateMany({
      where: { eventId: ctx.event.id, userId: request.userId, status: JoinStatus.PENDING, id: { not: request.id } },
      data: { status: JoinStatus.WITHDRAWN, decidedAt: new Date() },
    });
    return tx.joinRequest.update({
      where: { id: request.id },
      data: { status: JoinStatus.ACCEPTED, decidedAt: new Date() },
    });
  });

  await recordAudit({
    action: AuditAction.TEAM_MEMBER_ADDED,
    eventId: ctx.event.id,
    actorId: user.id,
    targetType: "team",
    targetId: request.teamId,
    summary: `A board request was accepted into team "${request.team.name}"`,
    metadata: { direction: request.direction, userId: request.userId },
    ipHash,
  });

  return result;
}
