import { createHmac, randomBytes } from "node:crypto";
import { prisma } from "../db.js";
import { badRequest, notFound } from "../lib/errors.js";
import { AuditAction, type AuditActionKey } from "./audit.service.js";
import type { EventContext } from "./authorization.service.js";

/** Account-level actions carry no event, so no event's webhook can hear them. */
const ACCOUNT_ACTIONS = new Set<AuditActionKey>([
  AuditAction.USER_REGISTERED,
  AuditAction.USER_LOGGED_IN,
  AuditAction.USER_LOGIN_FAILED,
  AuditAction.USER_LOGGED_OUT,
  AuditAction.USER_PROFILE_UPDATED,
  AuditAction.USER_PASSWORD_CHANGED,
  AuditAction.USER_SESSIONS_REVOKED,
  AuditAction.SIGN_IN_LINK_ISSUED,
]);

/** Subscribes a hook to every action, including ones added after it was created. */
export const ALL_EVENTS = "*";

/**
 * What a webhook may subscribe to: every event-scoped audit action. Webhooks hang off the
 * audit log, so anything an organizer, judge or participant does in an event is both
 * recorded and deliverable, and a new audited action is subscribable without touching this
 * file.
 */
export const WEBHOOK_EVENTS = [
  ALL_EVENTS,
  ...Object.values(AuditAction).filter((action) => !ACCOUNT_ACTIONS.has(action)),
] as [string, ...string[]];

export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

const TIMEOUT_MS = 5000;

export function signBody(secret: string, body: string): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

function assertUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw badRequest("Enter a full http or https URL.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw badRequest("Webhooks must use http or https.");
  }
  return url.toString();
}

export async function listWebhooks(ctx: EventContext) {
  const hooks = await prisma.webhook.findMany({
    where: { eventId: ctx.event.id },
    orderBy: { createdAt: "asc" },
    include: { deliveries: { orderBy: { createdAt: "desc" }, take: 5 } },
  });
  // The secret is shown once, at creation. Afterwards only its tail is exposed.
  return hooks.map(({ secret, ...hook }) => ({ ...hook, secretHint: `…${secret.slice(-4)}` }));
}

export async function createWebhook(
  ctx: EventContext,
  input: { url: string; events: WebhookEvent[] },
) {
  const secret = randomBytes(24).toString("base64url");
  const hook = await prisma.webhook.create({
    data: {
      eventId: ctx.event.id,
      url: assertUrl(input.url),
      events: input.events,
      secret,
    },
  });
  return { ...hook, secret };
}

export async function updateWebhook(
  ctx: EventContext,
  id: string,
  input: { url?: string; events?: WebhookEvent[]; active?: boolean },
) {
  const existing = await prisma.webhook.findFirst({ where: { id, eventId: ctx.event.id } });
  if (!existing) throw notFound("That webhook does not exist in this event.");
  const { secret: _secret, ...hook } = await prisma.webhook.update({
    where: { id: existing.id },
    data: {
      ...(input.url !== undefined ? { url: assertUrl(input.url) } : {}),
      ...(input.events !== undefined ? { events: input.events } : {}),
      ...(input.active !== undefined ? { active: input.active } : {}),
    },
  });
  return hook;
}

export async function deleteWebhook(ctx: EventContext, id: string) {
  const existing = await prisma.webhook.findFirst({ where: { id, eventId: ctx.event.id } });
  if (!existing) throw notFound("That webhook does not exist in this event.");
  await prisma.webhook.delete({ where: { id: existing.id } });
}

interface DispatchInput {
  action: string;
  eventId: string;
  summary: string;
  targetType?: string | null;
  targetId?: string | null;
}

/**
 * Delivers one audit event to every subscribed hook. Runs detached from the
 * request that caused it: a slow or dead receiver can never slow down or fail
 * an organizer's action. Every attempt is recorded, success or not.
 */
export async function dispatchWebhooks(input: DispatchInput): Promise<void> {
  const hooks = await prisma.webhook.findMany({
    where: { eventId: input.eventId, active: true, events: { hasSome: [input.action, ALL_EVENTS] } },
  });
  if (hooks.length === 0) return;

  const body = JSON.stringify({
    type: input.action,
    eventId: input.eventId,
    occurredAt: new Date().toISOString(),
    summary: input.summary,
    target: input.targetType ? { type: input.targetType, id: input.targetId ?? null } : null,
  });

  await Promise.all(
    hooks.map(async (hook) => {
      const started = Date.now();
      let statusCode: number | null = null;
      let error: string | null = null;
      try {
        const res = await fetch(hook.url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-podium-event": input.action,
            "x-podium-signature": `sha256=${signBody(hook.secret, body)}`,
          },
          body,
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        statusCode = res.status;
      } catch (err) {
        error = err instanceof Error ? err.message.slice(0, 300) : "delivery failed";
      }
      await prisma.webhookDelivery.create({
        data: {
          webhookId: hook.id,
          action: input.action,
          statusCode,
          ok: statusCode !== null && statusCode >= 200 && statusCode < 300,
          error,
          durationMs: Date.now() - started,
        },
      });
    }),
  );
}
