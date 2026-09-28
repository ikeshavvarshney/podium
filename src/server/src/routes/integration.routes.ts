import { EventRole } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../lib/async-handler.js";
import { requireAuth } from "../middleware/auth.js";
import { eventContext, loadEventContext, requireEventAdmin } from "../middleware/event-context.js";
import { writeRateLimit } from "../middleware/rate-limit.js";
import { validate } from "../middleware/validate.js";
import { AuditAction, recordAudit } from "../services/audit.service.js";
import { buildMyCertificate, certificateSummary } from "../services/certificate.service.js";
import { importRoster } from "../services/import.service.js";
import {
  WEBHOOK_EVENTS,
  createWebhook,
  deleteWebhook,
  listWebhooks,
  redeliver,
  updateWebhook,
} from "../services/webhook.service.js";

const router: Router = Router({ mergeParams: true });

// ----------------------------------------------------------------
// Bulk import
// ----------------------------------------------------------------

router.post(
  "/import/roster",
  requireAuth,
  asyncHandler(loadEventContext),
  requireEventAdmin,
  writeRateLimit,
  validate({
    body: z.object({
      role: z.enum([EventRole.JUDGE, EventRole.PARTICIPANT]),
      csv: z.string().max(200_000),
    }),
  }),
  asyncHandler(async (req, res) => {
    res.json(await importRoster(eventContext(req), req.body.role, req.body.csv, req.ipHash));
  }),
);

// ----------------------------------------------------------------
// Certificates
// ----------------------------------------------------------------

router.get(
  "/certificates/me",
  requireAuth,
  asyncHandler(loadEventContext),
  asyncHandler(async (req, res) => {
    res.json(await buildMyCertificate(eventContext(req)));
  }),
);

router.get(
  "/certificates/summary",
  requireAuth,
  asyncHandler(loadEventContext),
  requireEventAdmin,
  asyncHandler(async (req, res) => {
    res.json(await certificateSummary(eventContext(req)));
  }),
);

// ----------------------------------------------------------------
// Webhooks
// ----------------------------------------------------------------

const eventsSchema = z.array(z.enum(WEBHOOK_EVENTS)).min(1).max(WEBHOOK_EVENTS.length);

router.get(
  "/webhooks",
  requireAuth,
  asyncHandler(loadEventContext),
  requireEventAdmin,
  asyncHandler(async (req, res) => {
    res.json({ available: WEBHOOK_EVENTS, hooks: await listWebhooks(eventContext(req)) });
  }),
);

router.post(
  "/webhooks",
  requireAuth,
  asyncHandler(loadEventContext),
  requireEventAdmin,
  writeRateLimit,
  validate({ body: z.object({ url: z.string().trim().max(500), events: eventsSchema }) }),
  asyncHandler(async (req, res) => {
    const ctx = eventContext(req);
    const hook = await createWebhook(ctx, req.body);
    await recordAudit({
      action: AuditAction.WEBHOOK_CHANGED,
      eventId: ctx.event.id,
      actorId: ctx.user?.id ?? null,
      targetType: "webhook",
      targetId: hook.id,
      summary: `Webhook added for ${hook.events.length} event types`,
      ipHash: req.ipHash,
    });
    res.status(201).json(hook);
  }),
);

router.patch(
  "/webhooks/:webhookId",
  requireAuth,
  asyncHandler(loadEventContext),
  requireEventAdmin,
  validate({
    body: z.object({
      url: z.string().trim().max(500).optional(),
      events: eventsSchema.optional(),
      active: z.boolean().optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const ctx = eventContext(req);
    const hook = await updateWebhook(ctx, req.params.webhookId as string, req.body);
    await recordAudit({
      action: AuditAction.WEBHOOK_CHANGED,
      eventId: ctx.event.id,
      actorId: ctx.user?.id ?? null,
      targetType: "webhook",
      targetId: hook.id,
      summary: `Webhook updated`,
      ipHash: req.ipHash,
    });
    res.json(hook);
  }),
);

router.delete(
  "/webhooks/:webhookId",
  requireAuth,
  asyncHandler(loadEventContext),
  requireEventAdmin,
  asyncHandler(async (req, res) => {
    const ctx = eventContext(req);
    await deleteWebhook(ctx, req.params.webhookId as string);
    await recordAudit({
      action: AuditAction.WEBHOOK_CHANGED,
      eventId: ctx.event.id,
      actorId: ctx.user?.id ?? null,
      targetType: "webhook",
      targetId: req.params.webhookId as string,
      summary: `Webhook removed`,
      ipHash: req.ipHash,
    });
    res.status(204).end();
  }),
);

router.post(
  "/webhooks/:webhookId/deliveries/:deliveryId/retry",
  requireAuth,
  asyncHandler(loadEventContext),
  requireEventAdmin,
  writeRateLimit,
  validate({ params: z.object({ webhookId: z.string().uuid(), deliveryId: z.string().uuid() }).passthrough() }),
  asyncHandler(async (req, res) => {
    res.json(await redeliver(eventContext(req), req.params.webhookId as string, req.params.deliveryId as string));
  }),
);

export default router;
