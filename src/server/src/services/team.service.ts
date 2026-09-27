import { EventRole, TeamRole } from "@prisma/client";
import { prisma } from "../db.js";
import { hashToken, randomToken } from "../lib/crypto.js";
import { badRequest, conflict, forbidden, notFound } from "../lib/errors.js";
import type { AuthUser } from "../middleware/auth.js";
import { AuditAction, recordAudit } from "./audit.service.js";
import type { EventContext } from "./authorization.service.js";

export const teamInclude = {
  members: {
    include: {
      user: { select: { id: true, name: true, org: true, avatarHue: true } },
    },
    orderBy: { joinedAt: "asc" },
  },
  submission: { select: { id: true, name: true, status: true } },
} as const;

async function assertNotAlreadyOnATeam(eventId: string, userId: string): Promise<void> {
  const existing = await prisma.teamMember.findFirst({
    where: { userId, team: { eventId } },
    select: { id: true },
  });
  if (existing) throw conflict("You are already on a team for this event.");
}

function assertRegistrationWindowOpen(ctx: EventContext): void {
  const { registrationClosesAt } = ctx.event;
  if (registrationClosesAt && new Date() > registrationClosesAt) {
    throw forbidden("Team changes are closed for this event.");
  }
}

export async function listTeams(ctx: EventContext) {
  return prisma.team.findMany({
    where: { eventId: ctx.event.id },
    include: teamInclude,
    orderBy: { createdAt: "asc" },
  });
}

export async function createTeam(
  ctx: EventContext,
  user: AuthUser,
  input: { name: string; pitch?: string; lookingForMembers?: boolean },
  ipHash?: string,
) {
  if (!ctx.roles.has(EventRole.PARTICIPANT)) {
    throw forbidden("Register for this event before creating a team.");
  }
  assertRegistrationWindowOpen(ctx);
  await assertNotAlreadyOnATeam(ctx.event.id, user.id);

  const team = await prisma.team.create({
    data: {
      eventId: ctx.event.id,
      name: input.name.trim(),
      pitch: input.pitch?.trim() || null,
      lookingForMembers: input.lookingForMembers ?? false,
      members: { create: { userId: user.id, role: TeamRole.OWNER } },
    },
    include: teamInclude,
  });

  await recordAudit({
    action: AuditAction.TEAM_CREATED,
    eventId: ctx.event.id,
    actorId: user.id,
    targetType: "team",
    targetId: team.id,
    summary: `${user.name} created team "${team.name}"`,
    ipHash,
  });

  return team;
}

export async function loadTeamInEvent(eventId: string, teamId: string) {
  const team = await prisma.team.findFirst({
    where: { id: teamId, eventId },
    include: teamInclude,
  });
  if (!team) throw notFound("Team not found.");
  return team;
}

type LoadedTeam = Awaited<ReturnType<typeof loadTeamInEvent>>;

export function assertTeamOwner(team: LoadedTeam, userId: string): void {
  const membership = team.members.find((m) => m.userId === userId);
  if (membership?.role !== TeamRole.OWNER) {
    throw forbidden("Only the team owner can do that.");
  }
}

export function assertTeamMember(team: LoadedTeam, userId: string): void {
  if (!team.members.some((m) => m.userId === userId)) {
    throw forbidden("You are not a member of this team.");
  }
}

export async function updateTeam(
  ctx: EventContext,
  team: LoadedTeam,
  user: AuthUser,
  input: { name?: string; pitch?: string; lookingForMembers?: boolean },
  ipHash?: string,
) {
  assertTeamOwner(team, user.id);
  assertRegistrationWindowOpen(ctx);

  const updated = await prisma.team.update({
    where: { id: team.id },
    data: {
      ...(input.name !== undefined ? { name: input.name.trim() } : {}),
      ...(input.pitch !== undefined ? { pitch: input.pitch?.trim() || null } : {}),
      ...(input.lookingForMembers !== undefined
        ? { lookingForMembers: input.lookingForMembers }
        : {}),
    },
    include: teamInclude,
  });

  await recordAudit({
    action: AuditAction.TEAM_UPDATED,
    eventId: ctx.event.id,
    actorId: user.id,
    targetType: "team",
    targetId: team.id,
    summary: `Team "${updated.name}" updated`,
    ipHash,
  });

  return updated;
}

/**
 * The plaintext token is returned exactly once. Only its hash is persisted, so
 * a database leak does not hand an attacker working invite links.
 */
export async function createInvite(
  ctx: EventContext,
  team: LoadedTeam,
  user: AuthUser,
  input: { maxUses?: number | null; expiresAt?: Date | null },
  ipHash?: string,
) {
  assertTeamOwner(team, user.id);

  const token = randomToken(24);
  const invite = await prisma.teamInvite.create({
    data: {
      teamId: team.id,
      tokenHash: hashToken(token),
      createdById: user.id,
      maxUses: input.maxUses ?? null,
      expiresAt: input.expiresAt ?? null,
    },
  });

  await recordAudit({
    action: AuditAction.TEAM_INVITE_CREATED,
    eventId: ctx.event.id,
    actorId: user.id,
    targetType: "team_invite",
    targetId: invite.id,
    summary: `Invite link created for team "${team.name}"`,
    ipHash,
  });

  return { invite, token };
}

export async function revokeInvite(
  ctx: EventContext,
  team: LoadedTeam,
  user: AuthUser,
  inviteId: string,
  ipHash?: string,
) {
  assertTeamOwner(team, user.id);

  const invite = await prisma.teamInvite.findFirst({ where: { id: inviteId, teamId: team.id } });
  if (!invite) throw notFound("Invite not found.");

  await prisma.teamInvite.update({
    where: { id: invite.id },
    data: { revokedAt: new Date() },
  });

  await recordAudit({
    action: AuditAction.TEAM_INVITE_REVOKED,
    eventId: ctx.event.id,
    actorId: user.id,
    targetType: "team_invite",
    targetId: invite.id,
    summary: `Invite link revoked for team "${team.name}"`,
    ipHash,
  });
}

/**
 * Accepting an invite is the one place a team gains a member. Every guard
 * (validity, expiry, uses, event registration, team size) runs inside one
 * transaction so two simultaneous joins cannot exceed the size limit.
 */
export async function acceptInvite(user: AuthUser, token: string, ipHash?: string) {
  const invite = await prisma.teamInvite.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { team: { include: { event: true, members: { select: { userId: true } } } } },
  });
  if (!invite) throw notFound("That invite link is not valid.");
  if (invite.revokedAt) throw forbidden("That invite link has been revoked.");
  if (invite.expiresAt && new Date() > invite.expiresAt) {
    throw forbidden("That invite link has expired.");
  }
  if (invite.maxUses !== null && invite.useCount >= invite.maxUses) {
    throw forbidden("That invite link has already been used the maximum number of times.");
  }

  const { team } = invite;
  const event = team.event;

  if (event.registrationClosesAt && new Date() > event.registrationClosesAt) {
    throw forbidden("Registration for this event has closed.");
  }
  if (team.members.some((m) => m.userId === user.id)) {
    throw conflict("You are already on this team.");
  }
  await assertNotAlreadyOnATeam(event.id, user.id);

  const result = await prisma.$transaction(async (tx) => {
    const memberCount = await tx.teamMember.count({ where: { teamId: team.id } });
    if (memberCount >= event.maxTeamSize) {
      throw conflict(`This team is full (maximum ${event.maxTeamSize} members).`);
    }

    // Joining a team implies registering for the event.
    await tx.eventMembership.upsert({
      where: {
        eventId_userId_role: {
          eventId: event.id,
          userId: user.id,
          role: EventRole.PARTICIPANT,
        },
      },
      create: {
        eventId: event.id,
        userId: user.id,
        role: EventRole.PARTICIPANT,
        acceptedAt: new Date(),
      },
      update: {},
    });

    await tx.teamMember.create({
      data: { teamId: team.id, userId: user.id, role: TeamRole.MEMBER },
    });

    await tx.teamInvite.update({
      where: { id: invite.id },
      data: { useCount: { increment: 1 } },
    });

    return tx.team.findUniqueOrThrow({ where: { id: team.id }, include: teamInclude });
  });

  await recordAudit({
    action: AuditAction.TEAM_INVITE_ACCEPTED,
    eventId: event.id,
    actorId: user.id,
    targetType: "team",
    targetId: team.id,
    summary: `${user.name} joined team "${team.name}" via invite link`,
    ipHash,
  });

  return result;
}

export async function removeMember(
  ctx: EventContext,
  team: LoadedTeam,
  actor: AuthUser,
  targetUserId: string,
  ipHash?: string,
) {
  const isSelf = actor.id === targetUserId;
  if (!isSelf) assertTeamOwner(team, actor.id);
  else assertTeamMember(team, actor.id);
  assertRegistrationWindowOpen(ctx);

  const target = team.members.find((m) => m.userId === targetUserId);
  if (!target) throw notFound("That person is not on this team.");

  if (target.role === TeamRole.OWNER && team.members.length > 1) {
    throw badRequest("Transfer ownership before the owner leaves the team.");
  }

  await prisma.teamMember.delete({
    where: { teamId_userId: { teamId: team.id, userId: targetUserId } },
  });

  // A team with no members left is removed along with its draft submission.
  if (team.members.length === 1) {
    await prisma.team.delete({ where: { id: team.id } });
  }

  await recordAudit({
    action: AuditAction.TEAM_MEMBER_REMOVED,
    eventId: ctx.event.id,
    actorId: actor.id,
    targetType: "team",
    targetId: team.id,
    summary: isSelf
      ? `${actor.name} left team "${team.name}"`
      : `${actor.name} removed a member from team "${team.name}"`,
    ipHash,
  });
}

export async function getMyTeam(eventId: string, userId: string) {
  return prisma.team.findFirst({
    where: { eventId, members: { some: { userId } } },
    include: teamInclude,
  });
}
