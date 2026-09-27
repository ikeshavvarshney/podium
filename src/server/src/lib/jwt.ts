import jwt from "jsonwebtoken";
import { config } from "../config.js";

/**
 * The token proves identity only. It carries no roles: every event-scoped
 * permission is looked up from the database on each request.
 */
export interface TokenPayload {
  sub: string;
  tv: number;
  /** The device session this token belongs to, when issued to a browser. */
  sid?: string;
}

export function signToken(userId: string, tokenVersion: number, sessionId?: string): string {
  const payload: TokenPayload = { sub: userId, tv: tokenVersion, ...(sessionId ? { sid: sessionId } : {}) };
  return jwt.sign(payload, config.JWT_SECRET, {
    expiresIn: config.JWT_EXPIRES_IN,
    issuer: "podium",
  } as jwt.SignOptions);
}

/**
 * A token with fixed issue and expiry times, so the same user, token version and secret always
 * give the same string. The seed uses it for the acceptance checker, which never signs in and
 * reads its headers from .dogfood.toml. It is only as secret as JWT_SECRET: with the dev
 * default these tokens are public, and a deployment that sets its own secret invalidates
 * them. Bumping the user's token version revokes one, as for any other token.
 */
export function signFixedToken(userId: string, tokenVersion: number, issuedAt: Date, expiresAt: Date): string {
  const payload = {
    sub: userId,
    tv: tokenVersion,
    iat: Math.floor(issuedAt.getTime() / 1000),
    exp: Math.floor(expiresAt.getTime() / 1000),
  };
  return jwt.sign(payload, config.JWT_SECRET, { issuer: "podium" });
}

export function verifyToken(token: string): TokenPayload | null {
  try {
    const decoded = jwt.verify(token, config.JWT_SECRET, { issuer: "podium" });
    if (typeof decoded !== "object" || decoded === null) return null;
    const { sub, tv, sid } = decoded as Record<string, unknown>;
    if (typeof sub !== "string" || typeof tv !== "number") return null;
    return { sub, tv, ...(typeof sid === "string" ? { sid } : {}) };
  } catch {
    return null;
  }
}
