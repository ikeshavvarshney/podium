import type { PrismaClient } from "@prisma/client";
import { prisma } from "../db.js";
import { hashToken, randomToken } from "../lib/crypto.js";
import { badRequest, notFound } from "../lib/errors.js";
import { findEventByIdOrSlug } from "./authorization.service.js";
import { AuditAction, recordAudit } from "./audit.service.js";

export const API_TOKEN_PREFIX = "pod_";

export function isApiToken(token: string): boolean {
  return token.startsWith(API_TOKEN_PREFIX);
}

export interface CreateApiTokenInput {
  name: string;
  event?: string;
  expiresInDays?: number;
}

const visible = {
  id: true,
  name: true,
  prefix: true,
  eventId: true,
  event: { select: { slug: true, name: true } },
  expiresAt: true,
  lastUsedAt: true,
  revokedAt: true,
  createdAt: true,
} as const;

/** Stores a token by hash. `plaintext` is only for the fixture seed, whose tokens must be stable. */
export async function storeApiToken(
  db: PrismaClient,
  userId: string,
  input: { name: string; eventId?: string | null; expiresAt?: Date | null; plaintext?: string },
) {
  const token = input.plaintext ?? `${API_TOKEN_PREFIX}${randomToken(32)}`;
  if (!isApiToken(token)) throw new Error(`API tokens start with ${API_TOKEN_PREFIX}`);
  const record = await db.apiToken.upsert({
    where: { tokenHash: hashToken(token) },
    update: { revokedAt: null, userId, eventId: input.eventId ?? null, name: input.name },
    create: {
      userId,
      eventId: input.eventId ?? null,
      name: input.name,
      tokenHash: hashToken(token),
      prefix: token.slice(0, 12),
      expiresAt: input.expiresAt ?? null,
    },
    select: visible,
  });
  return { token, record };
}

export async function createApiToken(userId: string, input: CreateApiTokenInput, ipHash?: string) {
  let eventId: string | null = null;
  if (input.event) {
    const event = await findEventByIdOrSlug(input.event);
    const member = event
      ? event.ownerId === userId ||
        (await prisma.eventMembership.count({ where: { eventId: event.id, userId } })) > 0
      : false;
    if (!event || !member) throw badRequest("You can only scope a token to an event you take part in.");
    eventId = event.id;
  }
  const expiresAt = input.expiresInDays ? new Date(Date.now() + input.expiresInDays * 86_400_000) : null;
  const created = await storeApiToken(prisma, userId, { name: input.name, eventId, expiresAt });
  await recordAudit({
    action: AuditAction.API_TOKEN_CREATED,
    eventId,
    actorId: userId,
    targetType: "api_token",
    targetId: created.record.id,
    summary: `API token "${input.name}" created${eventId ? " for one event" : ""}`,
    ipHash,
  });
  return created;
}

export function listApiTokens(userId: string) {
  return prisma.apiToken.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, select: visible });
}

export async function revokeApiToken(userId: string, id: string, ipHash?: string) {
  const token = await prisma.apiToken.findFirst({ where: { id, userId }, select: { id: true, name: true, eventId: true } });
  if (!token) throw notFound("Token not found.");
  await prisma.apiToken.update({ where: { id }, data: { revokedAt: new Date() } });
  await recordAudit({
    action: AuditAction.API_TOKEN_REVOKED,
    eventId: token.eventId,
    actorId: userId,
    targetType: "api_token",
    targetId: id,
    summary: `API token "${token.name}" revoked`,
    ipHash,
  });
}

export interface ResolvedApiToken {
  user: { id: string; email: string; name: string; isOrganizer: boolean; isSuperAdmin: boolean };
  scope: { eventId: string; slug: string } | null;
}

export async function resolveApiToken(token: string): Promise<ResolvedApiToken | null> {
  const row = await prisma.apiToken.findUnique({
    where: { tokenHash: hashToken(token) },
    select: {
      id: true,
      revokedAt: true,
      expiresAt: true,
      lastUsedAt: true,
      eventId: true,
      event: { select: { slug: true } },
      user: { select: { id: true, email: true, name: true, isOrganizer: true, isSuperAdmin: true } },
    },
  });
  if (!row || row.revokedAt || (row.expiresAt && row.expiresAt < new Date())) return null;

  if (!row.lastUsedAt || Date.now() - row.lastUsedAt.getTime() > 60_000) {
    void prisma.apiToken.update({ where: { id: row.id }, data: { lastUsedAt: new Date() } }).catch(() => undefined);
  }

  const scope = row.eventId && row.event ? { eventId: row.eventId, slug: row.event.slug } : null;
  // An event-scoped token never carries the account's global capabilities.
  const user = scope ? { ...row.user, isOrganizer: false, isSuperAdmin: false } : row.user;
  return { user, scope };
}
