import { QuestionStage, QuestionType } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { asyncHandler } from "../lib/async-handler.js";
import { notFound } from "../lib/errors.js";
import { requireAuth } from "../middleware/auth.js";
import {
  eventContext,
  loadEventContext,
  requirePermission,
} from "../middleware/event-context.js";
import { validate } from "../middleware/validate.js";
import { AuditAction, recordAudit } from "../services/audit.service.js";

const router: Router = Router({ mergeParams: true });

const questionSchema = z.object({
  prompt: z.string().trim().min(1).max(300),
  stage: z.nativeEnum(QuestionStage).optional(),
  helpText: z.string().trim().max(500).nullish(),
  type: z.nativeEnum(QuestionType).optional(),
  options: z.array(z.string().trim().min(1).max(100)).max(30).optional(),
  required: z.boolean().optional(),
  publicAnswer: z.boolean().optional(),
  position: z.number().int().min(0).max(999).optional(),
});

router.get(
  "/",
  asyncHandler(loadEventContext),
  asyncHandler(async (req, res) => {
    res.json(
      await prisma.customQuestion.findMany({
        where: { eventId: eventContext(req).event.id },
        orderBy: { position: "asc" },
      }),
    );
  }),
);

router.post(
  "/",
  requireAuth,
  asyncHandler(loadEventContext),
  requirePermission("SETTINGS"),
  validate({ body: questionSchema }),
  asyncHandler(async (req, res) => {
    const ctx = eventContext(req);
    const question = await prisma.customQuestion.create({
      data: { eventId: ctx.event.id, ...req.body },
    });
    await recordAudit({
      action: AuditAction.QUESTION_CHANGED,
      eventId: ctx.event.id,
      actorId: ctx.user?.id ?? null,
      targetType: "question",
      targetId: question.id,
      summary: `Question added: ${question.prompt}`,
      ipHash: req.ipHash,
    });
    res.status(201).json(question);
  }),
);

router.patch(
  "/:questionId",
  requireAuth,
  asyncHandler(loadEventContext),
  requirePermission("SETTINGS"),
  validate({ body: questionSchema.partial() }),
  asyncHandler(async (req, res) => {
    const ctx = eventContext(req);
    const existing = await prisma.customQuestion.findFirst({
      where: { id: req.params.questionId as string, eventId: ctx.event.id },
    });
    if (!existing) throw notFound("Question not found.");
    const question = await prisma.customQuestion.update({ where: { id: existing.id }, data: req.body });
    await recordAudit({
      action: AuditAction.QUESTION_CHANGED,
      eventId: ctx.event.id,
      actorId: ctx.user?.id ?? null,
      targetType: "question",
      targetId: question.id,
      summary: `Question edited: ${question.prompt}`,
      ipHash: req.ipHash,
    });
    res.json(question);
  }),
);

router.delete(
  "/:questionId",
  requireAuth,
  asyncHandler(loadEventContext),
  requirePermission("SETTINGS"),
  asyncHandler(async (req, res) => {
    const ctx = eventContext(req);
    const existing = await prisma.customQuestion.findFirst({
      where: { id: req.params.questionId as string, eventId: ctx.event.id },
    });
    if (!existing) throw notFound("Question not found.");
    await prisma.customQuestion.delete({ where: { id: existing.id } });
    await recordAudit({
      action: AuditAction.QUESTION_CHANGED,
      eventId: ctx.event.id,
      actorId: ctx.user?.id ?? null,
      targetType: "question",
      targetId: existing.id,
      summary: `Question deleted: ${existing.prompt}`,
      ipHash: req.ipHash,
    });
    res.status(204).end();
  }),
);

export default router;
