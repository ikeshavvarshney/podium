import jwt from "jsonwebtoken";
import { config } from "../config.js";
import { sessionSecret } from "./instance-secrets.js";

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
  return jwt.sign(payload, sessionSecret(), {
    expiresIn: config.JWT_EXPIRES_IN,
    issuer: "podium",
  } as jwt.SignOptions);
}

export function verifyToken(token: string): TokenPayload | null {
  try {
    const decoded = jwt.verify(token, sessionSecret(), { issuer: "podium" });
    if (typeof decoded !== "object" || decoded === null) return null;
    const { sub, tv, sid } = decoded as Record<string, unknown>;
    if (typeof sub !== "string" || typeof tv !== "number") return null;
    return { sub, tv, ...(typeof sid === "string" ? { sid } : {}) };
  } catch {
    return null;
  }
}
