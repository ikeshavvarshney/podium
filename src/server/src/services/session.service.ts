import type { Request } from "express";
import { prisma } from "../db.js";
import { notFound } from "../lib/errors.js";
import { signToken } from "../lib/jwt.js";

/** How often a session's last-seen time is written, at most. */
const TOUCH_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Opens a device session and returns a token bound to it. The token still
 * carries the account's token version, so bumping it ends every session at
 * once, while revoking one session ends only that device.
 */
export async function openSession(userId: string, req: Request): Promise<string> {
  const [user, session] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { tokenVersion: true } }),
    prisma.session.create({
      data: {
        userId,
        userAgent: req.get("user-agent")?.slice(0, 300) ?? null,
        ipHash: req.ipHash ?? null,
      },
    }),
  ]);
  return signToken(userId, user.tokenVersion, session.id);
}

/** Returns false for a session that no longer admits requests. */
export async function checkSession(sessionId: string, userId: string): Promise<boolean> {
  const session = await prisma.session.findUnique({ where: { id: sessionId } });
  if (!session || session.userId !== userId || session.revokedAt) return false;

  if (Date.now() - session.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
    await prisma.session.update({ where: { id: session.id }, data: { lastSeenAt: new Date() } });
  }
  return true;
}

/** A short, readable device description from a user agent string. */
export function describeAgent(agent: string | null): { browser: string; os: string } {
  if (!agent) return { browser: "Unknown client", os: "" };
  const browser = /Edg\//.test(agent)
    ? "Edge"
    : /Firefox\//.test(agent)
      ? "Firefox"
      : /Chrome\//.test(agent)
        ? "Chrome"
        : /Safari\//.test(agent)
          ? "Safari"
          : /curl\//.test(agent)
            ? "curl"
            : "Browser";
  const os = /iPhone|iPad/.test(agent)
    ? "iOS"
    : /Android/.test(agent)
      ? "Android"
      : /Mac OS X/.test(agent)
        ? "macOS"
        : /Windows/.test(agent)
          ? "Windows"
          : /Linux/.test(agent)
            ? "Linux"
            : "";
  return { browser, os };
}

export async function listSessions(userId: string, currentId?: string) {
  const sessions = await prisma.session.findMany({
    where: { userId, revokedAt: null },
    orderBy: { lastSeenAt: "desc" },
    take: 20,
  });
  return sessions.map((s) => ({
    id: s.id,
    ...describeAgent(s.userAgent),
    ipHash: s.ipHash ? s.ipHash.slice(0, 8) : null,
    createdAt: s.createdAt,
    lastSeenAt: s.lastSeenAt,
    current: s.id === currentId,
  }));
}

export async function revokeSession(userId: string, sessionId: string) {
  const session = await prisma.session.findFirst({ where: { id: sessionId, userId } });
  if (!session) throw notFound("That session does not exist.");
  await prisma.session.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
}

/** Ends every session but the one making the request. */
export async function revokeOtherSessions(userId: string, keepId?: string) {
  const result = await prisma.session.updateMany({
    where: { userId, revokedAt: null, ...(keepId ? { id: { not: keepId } } : {}) },
    data: { revokedAt: new Date() },
  });
  return result.count;
}

/**
 * A fresh token for the caller's current session, after the account's token
 * version has moved on. Without a session (a scripted bearer token) the caller
 * gets a new session instead.
 */
export async function reissueToken(userId: string, req: Request): Promise<string> {
  if (!req.sessionId) return openSession(userId, req);
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { tokenVersion: true } });
  return signToken(userId, user.tokenVersion, req.sessionId);
}
