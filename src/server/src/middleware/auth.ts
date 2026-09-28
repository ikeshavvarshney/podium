import type { NextFunction, Request, Response } from "express";
import { AUTH_COOKIE } from "../config.js";
import { prisma } from "../db.js";
import { hashWithSalt } from "../lib/crypto.js";
import { sessionSecret } from "../lib/instance-secrets.js";
import { unauthorized } from "../lib/errors.js";
import { verifyToken } from "../lib/jwt.js";
import { isApiToken, resolveApiToken } from "../services/api-token.service.js";

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  isOrganizer: boolean;
  isSuperAdmin: boolean;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
      ipHash?: string;
      /** The device session the caller's token belongs to, if any. */
      sessionId?: string;
      /** Set when the caller authenticated with an API token rather than a session. */
      apiToken?: boolean;
    }
  }
}

function readToken(req: Request): string | null {
  const cookie = req.cookies?.[AUTH_COOKIE];
  if (typeof cookie === "string" && cookie.length > 0) return cookie;

  // Bearer is accepted so the REST API is usable from scripts and CI.
  const header = req.headers.authorization;
  if (typeof header === "string" && header.startsWith("Bearer ")) {
    return header.slice(7).trim() || null;
  }
  return null;
}

export function clientIpHash(req: Request): string {
  const ip = req.ip ?? req.socket.remoteAddress ?? "unknown";
  return hashWithSalt(ip, sessionSecret());
}

/** An event-scoped token authenticates only under /api/events/<its event>. */
function pathIsInEvent(url: string, scope: { eventId: string; slug: string }): boolean {
  const path = url.split("?")[0]!;
  return [scope.eventId, scope.slug].some((id) => {
    const base = `/api/events/${id}`;
    return path === base || path.startsWith(`${base}/`);
  });
}

/**
 * Resolves the caller if a valid token is present. Never rejects: routes that
 * require a user use `requireAuth`, public routes just see `req.user`
 * undefined.
 */
export async function attachUser(req: Request, _res: Response, next: NextFunction): Promise<void> {
  req.ipHash = clientIpHash(req);
  const token = readToken(req);
  if (!token) return next();

  if (isApiToken(token)) {
    const resolved = await resolveApiToken(token);
    if (!resolved) return next();
    if (resolved.scope && !pathIsInEvent(req.originalUrl, resolved.scope)) return next();
    req.user = resolved.user;
    req.apiToken = true;
    return next();
  }

  const payload = verifyToken(token);
  if (!payload) return next();

  const user = await prisma.user.findUnique({
    where: { id: payload.sub },
    select: {
      id: true,
      email: true,
      name: true,
      isOrganizer: true,
      isSuperAdmin: true,
      tokenVersion: true,
    },
  });

  // A stale tokenVersion means the session was revoked server-side.
  if (!user || user.tokenVersion !== payload.tv) return next();

  // A token bound to a device session dies with that session.
  if (payload.sid) {
    const { checkSession } = await import("../services/session.service.js");
    if (!(await checkSession(payload.sid, user.id))) return next();
    req.sessionId = payload.sid;
  }

  req.user = {
    id: user.id,
    email: user.email,
    name: user.name,
    isOrganizer: user.isOrganizer,
    isSuperAdmin: user.isSuperAdmin,
  };
  next();
}

export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  if (!req.user) return next(unauthorized());
  next();
}

export function currentUser(req: Request): AuthUser {
  if (!req.user) throw unauthorized();
  return req.user;
}
