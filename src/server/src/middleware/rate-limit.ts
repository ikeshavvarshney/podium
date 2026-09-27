import type { NextFunction, Request, Response } from "express";
import { tooManyRequests } from "../lib/errors.js";

interface Bucket {
  count: number;
  resetAt: number;
}

/**
 * Fixed-window limiter held in process memory. Deliberately not Redis: the
 * platform ships as a single API container and must run with the network off.
 */
class MemoryStore {
  private buckets = new Map<string, Bucket>();
  private lastSweep = Date.now();

  hit(key: string, windowMs: number): Bucket {
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

  countSince(prefix: string): number {
    const now = Date.now();
    let total = 0;
    for (const [key, bucket] of this.buckets) {
      if (key.startsWith(prefix) && bucket.resetAt > now) total += bucket.count;
    }
    return total;
  }

  reset(): void {
    this.buckets.clear();
  }

  private sweep(now: number): void {
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) this.buckets.delete(key);
    }
    this.lastSweep = now;
  }
}

export const rateLimitStore = new MemoryStore();

export interface RateLimitOptions {
  windowMs: number;
  max: number;
  /** Defaults to the hashed client IP. */
  key?: (req: Request) => string;
  message?: string;
}

export function rateLimit(name: string, options: RateLimitOptions) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const id = options.key ? options.key(req) : (req.ipHash ?? "unknown");
    const bucket = rateLimitStore.hit(`${name}:${id}`, options.windowMs);

    const remaining = Math.max(0, options.max - bucket.count);
    res.setHeader("X-RateLimit-Limit", String(options.max));
    res.setHeader("X-RateLimit-Remaining", String(remaining));
    res.setHeader("X-RateLimit-Reset", String(Math.ceil(bucket.resetAt / 1000)));

    if (bucket.count > options.max) {
      const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - Date.now()) / 1000));
      res.setHeader("Retry-After", String(retryAfter));
      return next(
        tooManyRequests(options.message ?? "Too many requests. Try again shortly.", {
          retryAfter,
        }),
      );
    }
    next();
  };
}

export const authRateLimit = rateLimit("auth", {
  windowMs: 15 * 60_000,
  max: 20,
  message: "Too many authentication attempts. Try again in a few minutes.",
});

export const writeRateLimit = rateLimit("write", {
  windowMs: 60_000,
  max: 120,
});
