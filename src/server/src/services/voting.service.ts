import { EventStatus, SubmissionStatus, VotingAccess, VotingMethod } from "@prisma/client";
import { createHash } from "node:crypto";
import {
  BallotError,
  priceBallot,
  shuffleForVoter,
  tally,
  type BallotEntry,
} from "../algorithms/voting.js";
import { prisma } from "../db.js";
import { badRequest, conflict, forbidden, notFound } from "../lib/errors.js";
import { AuditAction, recordAudit, recordAuditSafe } from "./audit.service.js";
import type { EventContext } from "./authorization.service.js";

export interface VotingWindow {
  open: boolean;
  reason?: string;
  opensAt: Date | null;
  closesAt: Date | null;
}

const DEFAULT_CONFIG = {
  enabled: false,
  access: VotingAccess.AUTHENTICATED as VotingAccess,
  method: VotingMethod.SINGLE as VotingMethod,
  creditBudget: 100,
  hideResults: true,
  shuffleBallot: true,
  allowVisitors: true,
  allowParticipants: true,
  allowJudges: false,
  allowAdmins: false,
  maxVotesPerIpPerHour: 60,
};

export async function getVotingConfig(eventId: string) {
  const config = await prisma.votingConfig.findUnique({ where: { eventId } });
  return config ?? { id: null, eventId, ...DEFAULT_CONFIG };
}

/**
 * The method and the credit budget decide what a ballot means, so they cannot change once the
 * poll is live or any ballot exists: doing so would silently rewrite votes already cast.
 */
export async function votingMethodLock(ctx: EventContext): Promise<{ locked: boolean; reason: string | null }> {
  const config = await getVotingConfig(ctx.event.id);
  const ballots = await prisma.vote.count({ where: { eventId: ctx.event.id } });
  if (ballots > 0) {
    return { locked: true, reason: "Ballots have already been cast, so the method and credit budget can no longer change." };
  }
  if (config.enabled && votingWindow(ctx.event, config).open) {
    return { locked: true, reason: "The poll is live. Close it before changing the method or credit budget." };
  }
  return { locked: false, reason: null };
}

export async function getVotingConfigForAdmin(ctx: EventContext) {
  const config = await getVotingConfig(ctx.event.id);
  const lock = await votingMethodLock(ctx);
  return { ...config, methodLocked: lock.locked, lockReason: lock.reason };
}

export async function upsertVotingConfig(
  ctx: EventContext,
  input: Partial<typeof DEFAULT_CONFIG>,
  ipHash?: string,
) {
  const current = await getVotingConfig(ctx.event.id);
  const changesMethod = input.method !== undefined && input.method !== current.method;
  const changesBudget = input.creditBudget !== undefined && input.creditBudget !== current.creditBudget;
  if (changesMethod || changesBudget) {
    const lock = await votingMethodLock(ctx);
    if (lock.locked) throw conflict(lock.reason ?? "The voting method is locked.");
  }
  const voters = { ...pickVoterRoles(current), ...pickVoterRoles(input) };
  if (!Object.values(voters).some(Boolean)) {
    throw badRequest("Validation failed.", { voters: "Allow at least one group to vote." });
  }
  if (input.method === VotingMethod.QUADRATIC && changesMethod && input.creditBudget === undefined) {
    throw badRequest("Validation failed.", { creditBudget: "Set how many credits each voter receives." });
  }

  const config = await prisma.votingConfig.upsert({
    where: { eventId: ctx.event.id },
    create: { eventId: ctx.event.id, ...DEFAULT_CONFIG, ...input },
    update: input,
  });

  await recordAudit({
    action: AuditAction.VOTING_CONFIGURED,
    eventId: ctx.event.id,
    actorId: ctx.user?.id ?? null,
    targetType: "voting_config",
    targetId: config.id,
    summary: `Community voting ${config.enabled ? "enabled" : "disabled"} (${config.method}, ${config.access})`,
    metadata: { ...input },
    ipHash,
  });

  return config;
}

/** The single source of truth for whether a ballot may be cast right now. */
export function votingWindow(
  event: { status: EventStatus; votingOpensAt: Date | null; votingClosesAt: Date | null },
  config: { enabled: boolean },
  now = new Date(),
): VotingWindow {
  const opensAt = event.votingOpensAt;
  const closesAt = event.votingClosesAt;

  if (!config.enabled) {
    return { open: false, reason: "Community voting is not enabled for this event.", opensAt, closesAt };
  }
  if (event.status === EventStatus.DRAFT) {
    return { open: false, reason: "This event is not open yet.", opensAt, closesAt };
  }
  if (event.status === EventStatus.ARCHIVED) {
    return { open: false, reason: "This event is archived.", opensAt, closesAt };
  }
  if (opensAt && now < opensAt) {
    return { open: false, reason: "Community voting has not opened yet.", opensAt, closesAt };
  }
  if (closesAt && now > closesAt) {
    return { open: false, reason: "Community voting has closed.", opensAt, closesAt };
  }
  return { open: true, opensAt, closesAt };
}

export interface VoterIdentity {
  voterKey: string;
  userId: string | null;
  voterEmail: string | null;
}

interface VoterRoles {
  allowVisitors: boolean;
  allowParticipants: boolean;
  allowJudges: boolean;
  allowAdmins: boolean;
}

function pickVoterRoles(config: Partial<VoterRoles>): Partial<VoterRoles> {
  const picked: Partial<VoterRoles> = {};
  for (const key of ["allowVisitors", "allowParticipants", "allowJudges", "allowAdmins"] as const) {
    if (config[key] !== undefined) picked[key] = config[key];
  }
  return picked;
}

/**
 * Why this caller may not vote in this event, or null if their roles allow it. Every role a
 * person holds must be allowed: an admin who also registered as a participant is still an
 * admin. A visitor is anyone with no role here, whether signed in or not.
 */
export function voterRoleProblem(
  ctx: EventContext,
  config: VoterRoles & { access: VotingAccess },
): string | null {
  if (ctx.isJudge && !config.allowJudges) return "Judges on this event may not cast community votes.";
  if (ctx.isEventAdmin && !config.allowAdmins) return "Organizers of this event may not cast community votes.";
  if (ctx.isParticipant && !config.allowParticipants) {
    return "Participants in this event may not cast community votes.";
  }
  const visitor = !ctx.isJudge && !ctx.isEventAdmin && !ctx.isParticipant;
  if (visitor && !config.allowVisitors) {
    return ctx.user
      ? "Only people taking part in this event may vote."
      : "Only people taking part in this event may vote. Sign in first.";
  }
  if (!ctx.user && config.access === VotingAccess.AUTHENTICATED) return "Sign in to vote in this event.";
  return null;
}

/**
 * Resolves who is voting under the event's access mode. The key is always
 * derived server-side: a client cannot nominate the identity it votes as.
 */
export function resolveVoter(
  ctx: EventContext,
  config: VoterRoles & { access: VotingAccess },
  email: string | undefined,
  ipHash: string | undefined,
): VoterIdentity {
  const problem = voterRoleProblem(ctx, config);
  if (problem) throw forbidden(problem);

  if (ctx.user) {
    return { voterKey: `user:${ctx.user.id}`, userId: ctx.user.id, voterEmail: null };
  }

  if (config.access === VotingAccess.EMAIL_GATED) {
    const normalized = (email ?? "").trim().toLowerCase();
    if (!normalized) throw badRequest("An email address is required to vote in this event.");
    return { voterKey: `email:${normalized}`, userId: null, voterEmail: normalized };
  }

  // OPEN_LINK: the best identity available is the hashed client address. It is
  // weak on purpose, and the event's own rate limit is what bounds abuse.
  if (!ipHash) throw badRequest("This ballot could not be attributed to a voter.");
  return { voterKey: `ip:${ipHash}`, userId: null, voterEmail: null };
}

async function listVotableSubmissions(eventId: string) {
  return prisma.submission.findMany({
    where: { eventId, status: SubmissionStatus.SUBMITTED },
    select: {
      id: true,
      name: true,
      tagline: true,
      thumbnailUrl: true,
      techTags: true,
      team: { select: { id: true, name: true } },
      track: { select: { id: true, name: true } },
    },
  });
}

/** The ballot a voter sees: ordering is per voter, and never the storage order. */
export async function getBallot(ctx: EventContext, email?: string, ipHash?: string) {
  const config = await getVotingConfig(ctx.event.id);
  const window = votingWindow(ctx.event, config);
  const submissions = await listVotableSubmissions(ctx.event.id);

  let voter: VoterIdentity | null = null;
  try {
    voter = resolveVoter(ctx, config, email, ipHash);
  } catch {
    voter = null;
  }

  const ordered =
    config.shuffleBallot && voter ? shuffleForVoter(submissions, voter.voterKey) : submissions;

  const existing = voter
    ? await prisma.vote.findMany({
        where: { eventId: ctx.event.id, voterKey: voter.voterKey },
        select: { submissionId: true, weight: true, credits: true },
      })
    : [];

  return {
    window,
    method: config.method,
    access: config.access,
    creditBudget: config.creditBudget,
    creditsSpent: existing.reduce((sum, v) => sum + v.credits, 0),
    hideResults: config.hideResults,
    /** Set when this caller's roles rule them out, so the ballot page can say why up front. */
    ineligibleReason: voterRoleProblem(ctx, config),
    submissions: ordered,
    myVotes: existing,
  };
}

export interface CastBallotInput {
  entries: BallotEntry[];
  email?: string;
}

/**
 * Replaces this voter's whole ballot in one transaction. Duplicate detection is
 * the database's unique (event, submission, voter) constraint rather than an
 * application-level check.
 */
export async function castBallot(
  ctx: EventContext,
  input: CastBallotInput,
  ipHash?: string,
  userAgent?: string,
) {
  const config = await getVotingConfig(ctx.event.id);
  const window = votingWindow(ctx.event, config);

  if (!window.open) {
    recordAuditSafe({
      action: AuditAction.VOTE_REJECTED,
      eventId: ctx.event.id,
      actorId: ctx.user?.id ?? null,
      targetType: "vote",
      summary: `Ballot rejected: ${window.reason}`,
      ipHash,
    });
    throw forbidden(window.reason ?? "Community voting is closed.");
  }

  const voter = resolveVoter(ctx, config, input.email, ipHash);

  const votable = await listVotableSubmissions(ctx.event.id);
  const allowed = new Set(votable.map((s) => s.id));
  for (const entry of input.entries) {
    if (!allowed.has(entry.submissionId)) {
      throw notFound("One of those projects is not open for voting in this event.");
    }
  }

  const ownTeamSubmissions = ctx.user
    ? await prisma.submission.findMany({
        where: { eventId: ctx.event.id, team: { members: { some: { userId: ctx.user.id } } } },
        select: { id: true },
      })
    : [];
  const ownIds = new Set(ownTeamSubmissions.map((s) => s.id));
  if (input.entries.some((e) => ownIds.has(e.submissionId) && e.weight > 0)) {
    recordAuditSafe({
      action: AuditAction.VOTE_REJECTED,
      eventId: ctx.event.id,
      actorId: ctx.user?.id ?? null,
      targetType: "vote",
      summary: "Ballot rejected: self-vote",
      ipHash,
    });
    throw forbidden("You cannot vote for your own team's project.");
  }

  let priced;
  try {
    priced = priceBallot(config.method, config.creditBudget, input.entries);
  } catch (err) {
    if (err instanceof BallotError) {
      recordAuditSafe({
        action: AuditAction.VOTE_REJECTED,
        eventId: ctx.event.id,
        actorId: ctx.user?.id ?? null,
        targetType: "vote",
        summary: `Ballot rejected: ${err.message}`,
        ipHash,
      });
      throw badRequest(err.message);
    }
    throw err;
  }

  const userAgentHash = userAgent
    ? createHash("sha256").update(userAgent).digest("hex").slice(0, 32)
    : null;

  await prisma.$transaction(async (tx) => {
    await tx.vote.deleteMany({ where: { eventId: ctx.event.id, voterKey: voter.voterKey } });
    const rows = priced.entries.filter((e) => e.weight > 0);
    if (rows.length > 0) {
      await tx.vote.createMany({
        data: rows.map((e) => ({
          eventId: ctx.event.id,
          submissionId: e.submissionId,
          userId: voter.userId,
          voterEmail: voter.voterEmail,
          voterKey: voter.voterKey,
          weight: e.weight,
          credits: e.credits,
          ipHash: ipHash ?? null,
          userAgentHash,
        })),
      });
    }
  });

  await recordAudit({
    action: AuditAction.VOTE_CAST,
    eventId: ctx.event.id,
    actorId: ctx.user?.id ?? null,
    targetType: "vote",
    summary: `Ballot cast: ${priced.entries.filter((e) => e.weight > 0).length} projects, ${priced.creditsSpent} credits`,
    metadata: { method: config.method, creditsSpent: priced.creditsSpent },
    ipHash,
  });

  return {
    creditsSpent: priced.creditsSpent,
    creditsRemaining: priced.creditsRemaining,
    entries: priced.entries,
  };
}

/** Tallies are hidden while the window is open, unless the organizer says otherwise. */
export async function getVoteResults(ctx: EventContext) {
  const config = await getVotingConfig(ctx.event.id);
  const window = votingWindow(ctx.event, config);

  if (config.hideResults && window.open && !ctx.isEventAdmin) {
    throw forbidden("Community results stay hidden until voting closes.");
  }

  const submissions = await listVotableSubmissions(ctx.event.id);
  const votes = await prisma.vote.findMany({
    where: { eventId: ctx.event.id },
    select: { submissionId: true, weight: true, credits: true, voterKey: true },
  });

  const rows = tally(votes, submissions.map((s) => s.id));
  const byId = new Map(submissions.map((s) => [s.id, s]));

  return {
    method: config.method,
    voters: new Set(votes.map((v) => v.voterKey)).size,
    totalWeight: rows.reduce((sum, r) => sum + r.weight, 0),
    hiddenUntilClose: config.hideResults,
    standings: rows.map((r) => ({ ...r, submission: byId.get(r.submissionId) ?? null })),
  };
}

/** Organizer view of every ballot line cast, with who cast it. */
export async function listBallots(ctx: EventContext) {
  const votes = await prisma.vote.findMany({
    where: { eventId: ctx.event.id },
    orderBy: { createdAt: "desc" },
    include: {
      user: { select: { id: true, name: true, email: true } },
      submission: { select: { id: true, name: true } },
    },
  });

  // A voter key appearing from several addresses, or one address carrying many
  // keys, is what ballot stuffing looks like. Flag it; never auto-reject.
  const keysByIp = new Map<string, Set<string>>();
  for (const vote of votes) {
    if (!vote.ipHash) continue;
    const keys = keysByIp.get(vote.ipHash) ?? new Set<string>();
    keys.add(vote.voterKey);
    keysByIp.set(vote.ipHash, keys);
  }

  return votes.map((vote) => ({
    id: vote.id,
    voterKey: vote.voterKey,
    voter: vote.user?.name ?? vote.voterEmail ?? "anonymous",
    email: vote.user?.email ?? vote.voterEmail,
    submission: vote.submission,
    weight: vote.weight,
    credits: vote.credits,
    createdAt: vote.createdAt,
    flag:
      vote.ipHash && (keysByIp.get(vote.ipHash)?.size ?? 0) > 1
        ? "Several voters share this address"
        : null,
  }));
}
