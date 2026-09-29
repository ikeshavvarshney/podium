import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { asyncHandler } from "../lib/async-handler.js";
import { forbidden, notFound } from "../lib/errors.js";
import { currentUser, requireAuth } from "../middleware/auth.js";
import { eventContext, loadEventContext, requirePermission } from "../middleware/event-context.js";
import { writeRateLimit } from "../middleware/rate-limit.js";
import { validate } from "../middleware/validate.js";
import { AuditAction, recordAudit } from "../services/audit.service.js";

const router: Router = Router({ mergeParams: true });

const authorSelect = {
  user: { select: { id: true, name: true, avatarHue: true } },
} as const;

const bodySchema = z.object({
  body: z.string().trim().min(1, "A comment needs a body.").max(2000),
});

async function loadSubmission(eventId: string, submissionId: string) {
  const submission = await prisma.submission.findFirst({
    where: { id: submissionId, eventId },
    select: { id: true, status: true },
  });
  if (!submission) throw notFound("That submission does not exist in this event.");
  return submission;
}

/**
 * Public reads mirror the gallery: only submitted projects carry comments a
 * member of the public may see, and a hidden comment never reaches a non-organizer caller.
 */
router.get(
  "/",
  asyncHandler(loadEventContext),
  asyncHandler(async (req, res) => {
    const ctx = eventContext(req);
    const submission = await loadSubmission(ctx.event.id, req.params.submissionId as string);
    if (submission.status !== "SUBMITTED" && !ctx.permissions.has("SUBMISSIONS")) {
      throw notFound("That submission does not exist in this event.");
    }

    const comments = await prisma.comment.findMany({
      where: {
        submissionId: submission.id,
        ...(ctx.permissions.has("SUBMISSIONS") ? {} : { hiddenAt: null }),
      },
      include: authorSelect,
      orderBy: { createdAt: "asc" },
    });
    res.json(comments);
  }),
);

router.post(
  "/",
  requireAuth,
  asyncHandler(loadEventContext),
  writeRateLimit,
  validate({ body: bodySchema }),
  asyncHandler(async (req, res) => {
    const ctx = eventContext(req);
    const user = currentUser(req);
    const submission = await loadSubmission(ctx.event.id, req.params.submissionId as string);
    if (submission.status !== "SUBMITTED" && !ctx.permissions.has("SUBMISSIONS")) {
      throw notFound("That submission does not exist in this event.");
    }

    const comment = await prisma.comment.create({
      data: {
        eventId: ctx.event.id,
        submissionId: submission.id,
        userId: user.id,
        body: req.body.body,
      },
      include: authorSelect,
    });

    await recordAudit({
      action: AuditAction.COMMENT_POSTED,
      eventId: ctx.event.id,
      actorId: user.id,
      targetType: "submission",
      targetId: submission.id,
      summary: `${user.name} commented on a submission`,
      ipHash: req.ipHash,
    });

    res.status(201).json(comment);
  }),
);

/** An organizer hides a comment rather than deleting it, so moderation stays auditable. */
router.post(
  "/:commentId/hide",
  requireAuth,
  asyncHandler(loadEventContext),
  requirePermission("SUBMISSIONS"),
  validate({ body: z.object({ reason: z.string().trim().max(300).optional() }) }),
  asyncHandler(async (req, res) => {
    const ctx = eventContext(req);
    const existing = await prisma.comment.findFirst({
      where: { id: req.params.commentId as string, eventId: ctx.event.id },
    });
    if (!existing) throw notFound("That comment does not exist in this event.");

    const comment = await prisma.comment.update({
      where: { id: existing.id },
      data: { hiddenAt: new Date(), hiddenReason: req.body.reason ?? null },
      include: authorSelect,
    });

    await recordAudit({
      action: AuditAction.COMMENT_HIDDEN,
      eventId: ctx.event.id,
      actorId: ctx.user?.id ?? null,
      targetType: "comment",
      targetId: comment.id,
      summary: `A comment was hidden${req.body.reason ? `: ${req.body.reason}` : ""}`,
      ipHash: req.ipHash,
    });

    res.json(comment);
  }),
);

/** The comment's own author may take it down; nobody else's comment is theirs to delete. */
router.delete(
  "/:commentId",
  requireAuth,
  asyncHandler(loadEventContext),
  asyncHandler(async (req, res) => {
    const ctx = eventContext(req);
    const user = currentUser(req);
    const existing = await prisma.comment.findFirst({
      where: { id: req.params.commentId as string, eventId: ctx.event.id },
    });
    if (!existing) throw notFound("That comment does not exist in this event.");
    if (existing.userId !== user.id && !ctx.permissions.has("SUBMISSIONS")) {
      throw forbidden("You can only remove your own comments.");
    }

    await prisma.comment.delete({ where: { id: existing.id } });
    res.status(204).end();
  }),
);

export default router;
