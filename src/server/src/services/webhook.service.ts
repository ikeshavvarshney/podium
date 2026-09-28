import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { WebhookOutboxStatus } from "@prisma/client";
import { config } from "../config.js";
import { prisma } from "../db.js";
import { badRequest, notFound } from "../lib/errors.js";
import { assertPublicUrl, OutboundBlockedError, postJson } from "../lib/outbound.js";
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

/** Delay before each retry. After the last one the delivery is marked FAILED. */
export const RETRY_DELAYS_MS = [10_000, 60_000, 5 * 60_000, 30 * 60_000, 2 * 60 * 60_000];

/**
 * HMAC-SHA256 over `timestamp.deliveryId.body`. Binding the timestamp and delivery id lets a
 * receiver reject a replay: check the timestamp is recent and the id unseen.
 */
export function signDelivery(secret: string, timestamp: string, deliveryId: string, body: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${deliveryId}.${body}`).digest("hex");
}

async function assertUrl(raw: string): Promise<string> {
  try {
    return (await assertPublicUrl(raw, config.WEBHOOK_ALLOW_PRIVATE)).toString();
  } catch (err) {
    if (err instanceof OutboundBlockedError) throw badRequest(`Webhooks must reach a public address: ${err.message}`);
    throw badRequest("Enter a full http or https URL.");
  }
}

export async function listWebhooks(ctx: EventContext) {
  const hooks = await prisma.webhook.findMany({
    where: { eventId: ctx.event.id },
    orderBy: { createdAt: "asc" },
    include: {
      deliveries: { orderBy: { createdAt: "desc" }, take: 5 },
      outbox: {
        where: { status: { not: WebhookOutboxStatus.DELIVERED } },
        orderBy: { createdAt: "desc" },
        take: 10,
        select: { id: true, action: true, status: true, attempts: true, nextAttemptAt: true, lastError: true },
      },
    },
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
      url: await assertUrl(input.url),
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
      ...(input.url !== undefined ? { url: await assertUrl(input.url) } : {}),
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
 * Queues one audit event for every subscribed hook, then tries each right away. The outbox row
 * is written first, so a crash or a dead receiver leaves a retry behind rather than a lost event.
 */
export async function dispatchWebhooks(input: DispatchInput): Promise<void> {
  const hooks = await prisma.webhook.findMany({
    where: { eventId: input.eventId, active: true, events: { hasSome: [input.action, ALL_EVENTS] } },
    select: { id: true },
  });
  if (hooks.length === 0) return;

  const occurredAt = new Date().toISOString();
  const rows = hooks.map((hook) => {
    const id = randomUUID();
    const body = JSON.stringify({
      id,
      type: input.action,
      eventId: input.eventId,
      occurredAt,
      summary: input.summary,
      target: input.targetType ? { type: input.targetType, id: input.targetId ?? null } : null,
    });
    return { id, webhookId: hook.id, action: input.action, body };
  });
  await prisma.webhookOutbox.createMany({ data: rows });
  await Promise.all(rows.map((row) => attemptDelivery(row.id)));
}

const isRetryableStatus = (status: number) => status >= 500 || status === 408 || status === 429;

/** One attempt at one outbox row. Safe to run concurrently: the row is claimed with SKIP LOCKED. */
export async function attemptDelivery(outboxId: string): Promise<void> {
  await prisma.$transaction(
    async (tx) => {
      const claimed = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "webhook_outbox"
        WHERE "id" = ${outboxId}::uuid AND "status" = 'PENDING' AND "next_attempt_at" <= (now() AT TIME ZONE 'UTC')
        FOR UPDATE SKIP LOCKED`;
      if (claimed.length === 0) return;

      const row = await tx.webhookOutbox.findUniqueOrThrow({
        where: { id: outboxId },
        include: { webhook: { select: { url: true, secret: true, active: true } } },
      });
      const attempt = row.attempts + 1;
      const started = Date.now();
      let statusCode: number | null = null;
      let error: string | null = null;
      let retryable = true;

      if (!row.webhook.active) {
        error = "webhook disabled";
        retryable = false;
      } else {
        try {
          const url = await assertPublicUrl(row.webhook.url, config.WEBHOOK_ALLOW_PRIVATE);
          const timestamp = String(Math.floor(Date.now() / 1000));
          statusCode = await postJson(
            url,
            row.body,
            {
              "x-podium-event": row.action,
              "x-podium-delivery": row.id,
              "x-podium-timestamp": timestamp,
              "x-podium-attempt": String(attempt),
              "x-podium-signature": `sha256=${signDelivery(row.webhook.secret, timestamp, row.id, row.body)}`,
            },
            { timeoutMs: TIMEOUT_MS, allowPrivate: config.WEBHOOK_ALLOW_PRIVATE },
          );
          if (statusCode < 200 || statusCode >= 300) {
            error = `receiver answered ${statusCode}`;
            retryable = isRetryableStatus(statusCode);
          }
        } catch (err) {
          error = err instanceof Error ? err.message.slice(0, 300) : "delivery failed";
          retryable = !(err instanceof OutboundBlockedError);
        }
      }

      const delay = RETRY_DELAYS_MS[attempt - 1];
      await tx.webhookDelivery.create({
        data: {
          webhookId: row.webhookId,
          outboxId: row.id,
          attempt,
          action: row.action,
          statusCode,
          ok: error === null,
          error,
          durationMs: Date.now() - started,
        },
      });
      await tx.webhookOutbox.update({
        where: { id: row.id },
        data: {
          attempts: attempt,
          lastError: error,
          ...(error === null
            ? { status: WebhookOutboxStatus.DELIVERED, deliveredAt: new Date() }
            : retryable && delay !== undefined
              ? { nextAttemptAt: new Date(Date.now() + delay) }
              : { status: WebhookOutboxStatus.FAILED }),
        },
      });
    },
    { timeout: TIMEOUT_MS * 3 },
  );
}

/** Retries whatever is due. Every API replica may run it; SKIP LOCKED keeps attempts single. */
export async function processDueDeliveries(limit = 20): Promise<number> {
  const due = await prisma.webhookOutbox.findMany({
    where: { status: WebhookOutboxStatus.PENDING, nextAttemptAt: { lte: new Date() } },
    orderBy: { nextAttemptAt: "asc" },
    take: limit,
    select: { id: true },
  });
  for (const row of due) {
    await attemptDelivery(row.id).catch((err) => console.error("[webhooks] attempt failed", err));
  }
  return due.length;
}

export function startWebhookWorker(intervalMs = 5000): () => void {
  let running = false;
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    processDueDeliveries()
      .catch((err) => console.error("[webhooks] worker", err))
      .finally(() => {
        running = false;
      });
  }, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}

/** Puts a delivery back in the queue and tries it now. */
export async function redeliver(ctx: EventContext, webhookId: string, outboxId: string) {
  const row = await prisma.webhookOutbox.findFirst({
    where: { id: outboxId, webhookId, webhook: { eventId: ctx.event.id } },
  });
  if (!row) throw notFound("That delivery does not exist in this event.");
  await prisma.webhookOutbox.update({
    where: { id: row.id },
    data: { status: WebhookOutboxStatus.PENDING, nextAttemptAt: new Date() },
  });
  await attemptDelivery(row.id);
  return prisma.webhookOutbox.findUniqueOrThrow({
    where: { id: row.id },
    select: { id: true, status: true, attempts: true, lastError: true, deliveredAt: true },
  });
}
