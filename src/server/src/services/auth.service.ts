import { createHash, randomBytes } from "node:crypto";
import { prisma } from "../db.js";
import { hashPassword, verifyPassword } from "../lib/crypto.js";
import { conflict, unauthorized } from "../lib/errors.js";
import { signToken } from "../lib/jwt.js";

/** Tokens are stored as a hash, never in the clear. */
const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
import { AuditAction, recordAudit } from "./audit.service.js";

export interface RegisterInput {
  email: string;
  password: string;
  name: string;
  /** "organizer" grants the global event-creation capability. */
  accountType: "user" | "organizer";
}

const publicUser = {
  id: true,
  email: true,
  name: true,
  isOrganizer: true,
  isSuperAdmin: true,
  pronouns: true,
  org: true,
  bio: true,
  link: true,
  avatarHue: true,
  createdAt: true,
} as const;

export async function registerUser(input: RegisterInput, ipHash?: string) {
  const email = input.email.trim().toLowerCase();
  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (existing) throw conflict("An account with that email already exists.");

  const user = await prisma.user.create({
    data: {
      email,
      name: input.name.trim(),
      passwordHash: await hashPassword(input.password),
      isOrganizer: input.accountType === "organizer",
    },
    select: publicUser,
  });

  await recordAudit({
    action: AuditAction.USER_REGISTERED,
    actorId: user.id,
    targetType: "user",
    targetId: user.id,
    summary: `${user.name} registered as ${input.accountType}`,
    ipHash,
  });

  return { user, token: signToken(user.id, 0) };
}

export async function loginUser(email: string, password: string, ipHash?: string) {
  const normalized = email.trim().toLowerCase();
  const record = await prisma.user.findUnique({ where: { email: normalized } });

  // Hash a dummy password when the account is missing so timing does not
  // reveal whether an email is registered.
  if (!record) {
    await verifyPassword(
      "$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHRzb21lc2FsdA$0000000000000000000000000000000000000000000",
      password,
    );
    throw unauthorized("Email or password is incorrect.");
  }

  const ok = await verifyPassword(record.passwordHash, password);
  if (!ok) {
    await recordAudit({
      action: AuditAction.USER_LOGIN_FAILED,
      targetType: "user",
      targetId: record.id,
      summary: `Failed sign-in attempt for ${normalized}`,
      ipHash,
    });
    throw unauthorized("Email or password is incorrect.");
  }

  await recordAudit({
    action: AuditAction.USER_LOGGED_IN,
    actorId: record.id,
    targetType: "user",
    targetId: record.id,
    summary: `${record.name} signed in`,
    ipHash,
  });

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: record.id },
    select: publicUser,
  });

  return { user, token: signToken(record.id, record.tokenVersion) };
}

export async function getProfile(userId: string) {
  return prisma.user.findUniqueOrThrow({ where: { id: userId }, select: publicUser });
}

/** Lists the events a user touches and the roles they hold in each. */
export async function getMyEventRoles(userId: string) {
  // The same shape the event card renders, so My events needs no second call.
  const eventCard = {
    id: true,
    slug: true,
    name: true,
    tagline: true,
    status: true,
    themeTags: true,
    mode: true,
    place: true,
    eligibility: true,
    minTeamSize: true,
    maxTeamSize: true,
    resultsPublished: true,
    registrationClosesAt: true,
    submissionsOpenAt: true,
    submissionDeadline: true,
    judgingClosesAt: true,
    votingClosesAt: true,
    owner: { select: { name: true, org: true } },
    prizes: { select: { amountCents: true, currency: true } },
    _count: { select: { submissions: true, memberships: true, teams: true } },
  } as const;

  const memberships = await prisma.eventMembership.findMany({
    where: { userId },
    include: { event: { select: eventCard } },
    orderBy: { createdAt: "desc" },
  });

  const owned = await prisma.event.findMany({
    where: { ownerId: userId },
    select: eventCard,
  });

  const byEvent = new Map<string, { event: (typeof owned)[number]; roles: string[] }>();
  for (const event of owned) byEvent.set(event.id, { event, roles: ["OWNER"] });
  for (const m of memberships) {
    const entry = byEvent.get(m.eventId);
    if (entry) entry.roles.push(m.role);
    else byEvent.set(m.eventId, { event: m.event, roles: [m.role] });
  }

  return [...byEvent.values()].map(({ event, roles }) => {
    const { prizes, ...rest } = event;
    return {
      event: {
        ...rest,
        prizePoolCents: prizes.reduce((sum, p) => sum + (p.amountCents ?? 0), 0),
        currency: prizes[0]?.currency ?? "USD",
      },
      roles,
    };
  });
}

export interface ProfileInput {
  name?: string;
  org?: string | null;
  pronouns?: string | null;
  bio?: string | null;
  link?: string | null;
  avatarHue?: string;
}

export async function updateProfile(userId: string, input: ProfileInput, ipHash?: string) {
  const user = await prisma.user.update({
    where: { id: userId },
    data: {
      ...(input.name !== undefined ? { name: input.name.trim() } : {}),
      ...(input.org !== undefined ? { org: input.org } : {}),
      ...(input.pronouns !== undefined ? { pronouns: input.pronouns } : {}),
      ...(input.bio !== undefined ? { bio: input.bio } : {}),
      ...(input.link !== undefined ? { link: input.link } : {}),
      ...(input.avatarHue !== undefined ? { avatarHue: input.avatarHue } : {}),
    },
    select: publicUser,
  });

  await recordAudit({
    action: AuditAction.USER_PROFILE_UPDATED,
    actorId: userId,
    targetType: "user",
    targetId: userId,
    summary: `${user.name} updated their profile`,
    metadata: { fields: Object.keys(input) },
    ipHash,
  });

  return user;
}

/**
 * Changing a password bumps token_version, which invalidates every session
 * signed before the change, including the one making the request.
 */
export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
  ipHash?: string,
) {
  const record = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const ok = await verifyPassword(record.passwordHash, currentPassword);
  if (!ok) throw unauthorized("Your current password is incorrect.");

  const updated = await prisma.user.update({
    where: { id: userId },
    data: {
      passwordHash: await hashPassword(newPassword),
      tokenVersion: { increment: 1 },
    },
  });

  await recordAudit({
    action: AuditAction.USER_PASSWORD_CHANGED,
    actorId: userId,
    targetType: "user",
    targetId: userId,
    summary: `${record.name} changed their password`,
    ipHash,
  });

  return signToken(userId, updated.tokenVersion);
}

/** Revokes every session for this account by bumping the token version. */
export async function revokeSessions(userId: string, ipHash?: string) {
  const updated = await prisma.user.update({
    where: { id: userId },
    data: { tokenVersion: { increment: 1 } },
  });

  await recordAudit({
    action: AuditAction.USER_SESSIONS_REVOKED,
    actorId: userId,
    targetType: "user",
    targetId: userId,
    summary: `${updated.name} revoked their other sessions`,
    ipHash,
  });

  return signToken(userId, updated.tokenVersion);
}

/**
 * Passwordless sign-in. The platform sends no email by design, so delivery is
 * pluggable: with no transport configured the link is written to the server
 * log, which is how a self-hosted operator collects it. Only the hash of the
 * token is stored, so reading the database cannot mint a session.
 */
export async function issueSignInToken(email: string, ipHash?: string) {
  const normalized = email.trim().toLowerCase();
  const user = await prisma.user.findUnique({
    where: { email: normalized },
    select: { id: true, name: true },
  });

  // Always report success: whether an address is registered is not public.
  if (!user) return null;

  const token = randomBytes(32).toString("base64url");
  await prisma.signInToken.create({
    data: {
      userId: user.id,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
      ipHash: ipHash ?? null,
    },
  });

  await recordAudit({
    action: AuditAction.SIGN_IN_LINK_ISSUED,
    actorId: user.id,
    targetType: "user",
    targetId: user.id,
    summary: `Sign-in link issued for ${normalized}`,
    ipHash,
  });

  return { user, token };
}

export async function consumeSignInToken(token: string, ipHash?: string) {
  const record = await prisma.signInToken.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: { select: publicUser } },
  });

  if (!record || record.usedAt || record.expiresAt < new Date()) {
    throw unauthorized("That sign-in link is no longer valid.");
  }

  const updated = await prisma.signInToken.updateMany({
    where: { id: record.id, usedAt: null },
    data: { usedAt: new Date() },
  });
  // A second consumer racing the first loses: the link is strictly single use.
  if (updated.count === 0) throw unauthorized("That sign-in link is no longer valid.");

  const fresh = await prisma.user.findUniqueOrThrow({
    where: { id: record.userId },
    select: { tokenVersion: true },
  });

  await recordAudit({
    action: AuditAction.USER_LOGGED_IN,
    actorId: record.userId,
    targetType: "user",
    targetId: record.userId,
    summary: `${record.user.name} signed in with a link`,
    ipHash,
  });

  return { user: record.user, token: signToken(record.userId, fresh.tokenVersion) };
}
