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
  requireEventAdmin,
} from "../middleware/event-context.js";
import { validate } from "../middleware/validate.js";

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
  requireEventAdmin,
  validate({ body: questionSchema }),
  asyncHandler(async (req, res) => {
    const question = await prisma.customQuestion.create({
      data: { eventId: eventContext(req).event.id, ...req.body },
    });
    res.status(201).json(question);
  }),
);

router.patch(
  "/:questionId",
  requireAuth,
  asyncHandler(loadEventContext),
  requireEventAdmin,
  validate({ body: questionSchema.partial() }),
  asyncHandler(async (req, res) => {
    const existing = await prisma.customQuestion.findFirst({
      where: { id: req.params.questionId as string, eventId: eventContext(req).event.id },
    });
    if (!existing) throw notFound("Question not found.");
    res.json(
      await prisma.customQuestion.update({ where: { id: existing.id }, data: req.body }),
    );
  }),
);

router.delete(
  "/:questionId",
  requireAuth,
  asyncHandler(loadEventContext),
  requireEventAdmin,
  asyncHandler(async (req, res) => {
    const existing = await prisma.customQuestion.findFirst({
      where: { id: req.params.questionId as string, eventId: eventContext(req).event.id },
    });
    if (!existing) throw notFound("Question not found.");
    await prisma.customQuestion.delete({ where: { id: existing.id } });
    res.status(204).end();
  }),
);

export default router;
