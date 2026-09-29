import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { asyncHandler } from "../lib/async-handler.js";
import { notFound } from "../lib/errors.js";
import { requireAuth } from "../middleware/auth.js";
import { eventContext, loadEventContext, requirePermission } from "../middleware/event-context.js";
import { writeRateLimit } from "../middleware/rate-limit.js";
import { validate } from "../middleware/validate.js";
import { AuditAction, recordAudit } from "../services/audit.service.js";

/**
 * Sponsor challenges. "entries" is a live count of submitted projects that
 * opted into this challenge, not a number an organizer types in.
 */

const challengeSchema = z.object({
  sponsor: z.string().trim().min(1, "A sponsor name is required.").max(120),
  name: z.string().trim().min(1, "A challenge needs a name.").max(160),
  brief: z.string().trim().min(1, "A one-line brief is required.").max(400),
  amountCents: z.number().int().min(0).nullish(),
  // Every amount on the platform is in US dollars.
  currency: z.literal("USD").optional(),
  tags: z.array(z.string().trim().min(1).max(30)).max(8).optional(),
  position: z.number().int().min(0).max(999).optional(),
});

const router: Router = Router({ mergeParams: true });

async function withEntries(eventId: string, challenges: { id: string }[]) {
  const counts = await Promise.all(
    challenges.map((c) =>
      prisma.submission.count({
        where: { eventId, status: "SUBMITTED", challengeIds: { has: c.id } },
      }),
    ),
  );
  return challenges.map((c, i) => ({ ...c, entries: counts[i] }));
}

router.get(
  "/",
  asyncHandler(loadEventContext),
  asyncHandler(async (req, res) => {
    const ctx = eventContext(req);
    const challenges = await prisma.challenge.findMany({
      where: { eventId: ctx.event.id },
      orderBy: { position: "asc" },
    });
    res.json(await withEntries(ctx.event.id, challenges));
  }),
);

router.post(
  "/",
  requireAuth,
  asyncHandler(loadEventContext),
  requirePermission("SETTINGS"),
  writeRateLimit,
  validate({ body: challengeSchema }),
  asyncHandler(async (req, res) => {
    const ctx = eventContext(req);
    const count = await prisma.challenge.count({ where: { eventId: ctx.event.id } });
    const challenge = await prisma.challenge.create({
      data: { ...req.body, eventId: ctx.event.id, position: req.body.position ?? count },
    });
    await recordAudit({
      action: AuditAction.CHALLENGE_CHANGED,
      eventId: ctx.event.id,
      actorId: ctx.user?.id ?? null,
      targetType: "challenge",
      targetId: challenge.id,
      summary: `Challenge added: ${challenge.name} (${challenge.sponsor})`,
      ipHash: req.ipHash,
    });
    res.status(201).json({ ...challenge, entries: 0 });
  }),
);

router.patch(
  "/:challengeId",
  requireAuth,
  asyncHandler(loadEventContext),
  requirePermission("SETTINGS"),
  validate({ body: challengeSchema.partial() }),
  asyncHandler(async (req, res) => {
    const ctx = eventContext(req);
    const existing = await prisma.challenge.findFirst({
      where: { id: req.params.challengeId as string, eventId: ctx.event.id },
    });
    if (!existing) throw notFound("That challenge does not exist in this event.");
    const challenge = await prisma.challenge.update({ where: { id: existing.id }, data: req.body });
    const [withCount] = await withEntries(ctx.event.id, [challenge]);
    res.json(withCount);
  }),
);

router.delete(
  "/:challengeId",
  requireAuth,
  asyncHandler(loadEventContext),
  requirePermission("SETTINGS"),
  asyncHandler(async (req, res) => {
    const ctx = eventContext(req);
    const existing = await prisma.challenge.findFirst({
      where: { id: req.params.challengeId as string, eventId: ctx.event.id },
    });
    if (!existing) throw notFound("That challenge does not exist in this event.");
    await prisma.challenge.delete({ where: { id: existing.id } });
    await recordAudit({
      action: AuditAction.CHALLENGE_CHANGED,
      eventId: ctx.event.id,
      actorId: ctx.user?.id ?? null,
      targetType: "challenge",
      targetId: existing.id,
      summary: `Challenge removed: ${existing.name}`,
      ipHash: req.ipHash,
    });
    res.status(204).end();
  }),
);

export default router;
