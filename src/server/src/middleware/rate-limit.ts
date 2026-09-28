import type { NextFunction, Request, Response } from "express";
import { config } from "../config.js";
import { prisma } from "../db.js";
import { tooManyRequests } from "../lib/errors.js";

interface Bucket {
  count: number;
  resetAt: number;
}

interface Store {
  hit(key: string, windowMs: number): Promise<Bucket>;
  peek(key: string): Promise<Bucket | null>;
  clear(key: string): Promise<void>;
  reset(): Promise<void>;
}

/** Fixed windows in process memory. Right for one API container, and the default. */
export class MemoryStore implements Store {
  private buckets = new Map<string, Bucket>();
  private lastSweep = Date.now();

  async hit(key: string, windowMs: number): Promise<Bucket> {
    const now = Date.now();
    if (now - this.lastSweep > 60_000) this.sweep(now);
    const existing = this.buckets.get(key);
    if (!existing || existing.resetAt <= now) {
      const fresh = { count: 1, resetAt: now + windowMs };
      this.buckets.set(key, fresh);
      return fresh;
    }
    existing.count += 1;
    return existing;
  }

  async peek(key: string): Promise<Bucket | null> {
    const bucket = this.buckets.get(key);
    return bucket && bucket.resetAt > Date.now() ? bucket : null;
  }

  async clear(key: string): Promise<void> {
    this.buckets.delete(key);
  }

  async reset(): Promise<void> {
    this.buckets.clear();
  }

  private sweep(now: number): void {
    for (const [key, bucket] of this.buckets) if (bucket.resetAt <= now) this.buckets.delete(key);
    this.lastSweep = now;
  }
}

/** The same windows in Postgres, shared by every API replica. RATE_LIMIT_STORE=postgres. */
export class PostgresStore implements Store {
  async hit(key: string, windowMs: number): Promise<Bucket> {
    if (Math.random() < 0.01) {
      void prisma.$executeRaw`DELETE FROM "rate_limit_buckets" WHERE "reset_at" < (now() AT TIME ZONE 'UTC') - interval '1 hour'`.catch(() => undefined);
    }
    const rows = await prisma.$queryRaw<Array<{ count: number; reset_at: Date }>>`
      INSERT INTO "rate_limit_buckets" AS b ("key", "count", "reset_at")
      VALUES (${key}, 1, (now() AT TIME ZONE 'UTC') + ${windowMs} * interval '1 millisecond')
      ON CONFLICT ("key") DO UPDATE SET
        "count" = CASE WHEN b."reset_at" <= (now() AT TIME ZONE 'UTC') THEN 1 ELSE b."count" + 1 END,
        "reset_at" = CASE WHEN b."reset_at" <= (now() AT TIME ZONE 'UTC') THEN EXCLUDED."reset_at" ELSE b."reset_at" END
      RETURNING "count", "reset_at"`;
    return { count: rows[0]!.count, resetAt: rows[0]!.reset_at.getTime() };
  }

  async peek(key: string): Promise<Bucket | null> {
    const rows = await prisma.$queryRaw<Array<{ count: number; reset_at: Date }>>`
      SELECT "count", "reset_at" FROM "rate_limit_buckets" WHERE "key" = ${key} AND "reset_at" > (now() AT TIME ZONE 'UTC')`;
    return rows[0] ? { count: rows[0].count, resetAt: rows[0].reset_at.getTime() } : null;
  }

  async clear(key: string): Promise<void> {
    await prisma.$executeRaw`DELETE FROM "rate_limit_buckets" WHERE "key" = ${key}`;
  }

  async reset(): Promise<void> {
    await prisma.$executeRaw`DELETE FROM "rate_limit_buckets"`;
  }
}

export const rateLimitStore: Store = config.RATE_LIMIT_STORE === "postgres" ? new PostgresStore() : new MemoryStore();

export interface RateLimitOptions {
  windowMs: number;
  max: number;
  /** Defaults to the hashed client IP. */
  key?: (req: Request) => string;
  message?: string;
}

function refuse(res: Response, bucket: Bucket, message: string) {
  const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - Date.now()) / 1000));
  res.setHeader("Retry-After", String(retryAfter));
  return tooManyRequests(message, { retryAfter });
}

export function rateLimit(name: string, options: RateLimitOptions) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const id = options.key ? options.key(req) : (req.ipHash ?? "unknown");
    rateLimitStore
      .hit(`${name}:${id}`, options.windowMs)
      .then((bucket) => {
        res.setHeader("X-RateLimit-Limit", String(options.max));
        res.setHeader("X-RateLimit-Remaining", String(Math.max(0, options.max - bucket.count)));
        res.setHeader("X-RateLimit-Reset", String(Math.ceil(bucket.resetAt / 1000)));
        if (bucket.count > options.max) {
          return next(refuse(res, bucket, options.message ?? "Too many requests. Try again shortly."));
        }
        next();
      })
      .catch(next);
  };
}

/**
 * A ceiling on all authentication traffic from one address. Generous, because a venue puts
 * hundreds of people behind one NAT address; failed attempts have their own, tighter limits.
 */
export const authRateLimit = rateLimit("auth", {
  windowMs: 15 * 60_000,
  max: 300,
  message: "Too many authentication attempts. Try again in a few minutes.",
});

/** Public reads: plenty for a person browsing, a brake on bulk harvesting. */
export const readRateLimit = rateLimit("read", {
  windowMs: 60_000,
  max: 240,
  message: "Too many requests for the gallery. Slow down and try again shortly.",
});

export const writeRateLimit = rateLimit("write", {
  windowMs: 60_000,
  max: 120,
});

const FAILURE_WINDOW_MS = 15 * 60_000;
/** Guessing one account's password from one address. */
export const MAX_FAILURES_PER_ACCOUNT = 10;
/** Stuffing many accounts from one address. */
export const MAX_FAILURES_PER_ADDRESS = 50;

const failureKeys = (email: string, ipHash: string | undefined) => ({
  account: `login-fail:${email.trim().toLowerCase()}:${ipHash ?? "unknown"}`,
  address: `login-fail-ip:${ipHash ?? "unknown"}`,
});

/**
 * Only failures count, so a room full of people signing in successfully never locks itself out.
 * Keyed by account and address together, so an attacker elsewhere cannot lock a real user out.
 */
export async function assertLoginAllowed(email: string, ipHash: string | undefined, res: Response): Promise<void> {
  const keys = failureKeys(email, ipHash);
  const [account, address] = await Promise.all([rateLimitStore.peek(keys.account), rateLimitStore.peek(keys.address)]);
  if (account && account.count >= MAX_FAILURES_PER_ACCOUNT) {
    throw refuse(res, account, "Too many failed sign-ins for this account. Try again in a few minutes, or use a sign-in link.");
  }
  if (address && address.count >= MAX_FAILURES_PER_ADDRESS) {
    throw refuse(res, address, "Too many failed sign-ins from this address. Try again in a few minutes.");
  }
}

export async function recordLoginFailure(email: string, ipHash: string | undefined): Promise<void> {
  const keys = failureKeys(email, ipHash);
  await Promise.all([rateLimitStore.hit(keys.account, FAILURE_WINDOW_MS), rateLimitStore.hit(keys.address, FAILURE_WINDOW_MS)]);
}

export async function clearLoginFailures(email: string, ipHash: string | undefined): Promise<void> {
  await rateLimitStore.clear(failureKeys(email, ipHash).account);
}
