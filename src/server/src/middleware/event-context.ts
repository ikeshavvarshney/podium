import type { NextFunction, Request, Response } from "express";
import { badRequest, forbidden } from "../lib/errors.js";
import type { EventArea } from "../lib/permissions.js";
import {
  assertEventAdmin,
  assertPermission,
  assertEventVisible,
  assertJudge,
  buildEventContext,
  type EventContext,
} from "../services/authorization.service.js";

declare global {
  namespace Express {
    interface Request {
      eventContext?: EventContext;
    }
  }
}

/**
 * Resolves `:eventId` into a full permission context. Mounted on every
 * event-scoped router, so no downstream handler ever has to trust a client
 * supplied event id, role or judge id.
 */
export async function loadEventContext(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  const idOrSlug = req.params.eventId;
  if (!idOrSlug) return next(badRequest("An event identifier is required."));

  const ctx = await buildEventContext(idOrSlug, req.user ?? null);
  assertEventVisible(ctx);
  req.eventContext = ctx;
  next();
}

export function eventContext(req: Request): EventContext {
  if (!req.eventContext) {
    throw new Error("loadEventContext must run before this handler.");
  }
  return req.eventContext;
}

export function requireEventAdmin(req: Request, _res: Response, next: NextFunction): void {
  assertEventAdmin(eventContext(req));
  next();
}

/** Admin access limited to one or more organizer areas; any of them is enough. */
export function requirePermission(...areas: EventArea[]) {
  const requirePermission = (req: Request, _res: Response, next: NextFunction): void => {
    assertPermission(eventContext(req), areas);
    next();
  };
  return Object.assign(requirePermission, { areas });
}

export function requireJudge(req: Request, _res: Response, next: NextFunction): void {
  assertJudge(eventContext(req));
  next();
}

export function requireOrganizerCapability(req: Request, _res: Response, next: NextFunction): void {
  if (req.user?.isOrganizer || req.user?.isSuperAdmin) return next();
  next(forbidden("An organizer account is required to perform this action."));
}
