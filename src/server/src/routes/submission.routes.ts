import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { asyncHandler } from "../lib/async-handler.js";
import { currentUser, requireAuth } from "../middleware/auth.js";
import {
  eventContext,
  loadEventContext,
  requireEventAdmin,
} from "../middleware/event-context.js";
import { writeRateLimit } from "../middleware/rate-limit.js";
import { httpUrl, validate } from "../middleware/validate.js";
import {
  galleryFacets,
  getGalleryEntry,
  listGallery,
} from "../services/gallery.service.js";
import {
  createSubmission,
  getMySubmission,
  setSubmissionLock,
  submissionWindow,
  submitSubmission,
  updateSubmission,
  withdrawSubmission,
} from "../services/submission.service.js";
import commentRoutes from "./comment.routes.js";

const router: Router = Router({ mergeParams: true });

router.use("/:submissionId/comments", commentRoutes);

const nullableUrl = httpUrl.nullish().or(z.literal("").transform(() => null));

const submissionSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  tagline: z.string().trim().max(90, "Keep the tagline under 90 characters.").nullish(),
  description: z.string().max(20000).nullish(),
  thumbnailUrl: nullableUrl,
  repoUrl: nullableUrl,
  liveUrl: nullableUrl,
  videoUrl: nullableUrl,
  techTags: z.array(z.string().trim().min(1).max(30)).max(20).optional(),
  challengeIds: z.array(z.string().uuid()).max(8).optional(),
  license: z.string().trim().max(40).nullish(),
  trackId: z.string().uuid().nullish(),
  declarations: z.record(z.boolean()).optional(),
  answers: z
    .array(z.object({ questionId: z.string().uuid(), value: z.string().max(5000) }))
    .max(30)
    .optional(),
  images: z
    .array(z.object({ url: httpUrl, caption: z.string().trim().max(200).nullish() }))
    .max(10)
    .optional(),
});

const galleryQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  track: z.string().trim().max(80).optional(),
  tag: z.string().trim().max(30).optional(),
  sort: z.enum(["recent", "name", "random"]).optional(),
  take: z.coerce.number().int().min(1).max(100).optional(),
  skip: z.coerce.number().int().min(0).optional(),
  seed: z.coerce.number().int().optional(),
});

router.get(
  "/",
  asyncHandler(loadEventContext),
  validate({ query: galleryQuerySchema }),
  asyncHandler(async (req, res) => {
    res.json(await listGallery(eventContext(req), req.query));
  }),
);

router.get(
  "/facets",
  asyncHandler(loadEventContext),
  asyncHandler(async (req, res) => {
    res.json(await galleryFacets(eventContext(req)));
  }),
);

/** Server-authoritative deadline state, so the client never guesses. */
router.get(
  "/window",
  asyncHandler(loadEventContext),
  asyncHandler(async (req, res) => {
    res.json(submissionWindow(eventContext(req).event));
  }),
);

router.get(
  "/mine",
  requireAuth,
  asyncHandler(loadEventContext),
  asyncHandler(async (req, res) => {
    const ctx = eventContext(req);
    res.json({
      submission: await getMySubmission(ctx, currentUser(req).id),
      window: submissionWindow(ctx.event),
    });
  }),
);

router.post(
  "/",
  requireAuth,
  asyncHandler(loadEventContext),
  writeRateLimit,
  validate({ body: submissionSchema }),
  asyncHandler(async (req, res) => {
    const submission = await createSubmission(
      eventContext(req),
      currentUser(req),
      req.body,
      req.ipHash,
    );
    res.status(201).json(submission);
  }),
);

router.patch(
  "/mine",
  requireAuth,
  asyncHandler(loadEventContext),
  writeRateLimit,
  validate({ body: submissionSchema }),
  asyncHandler(async (req, res) => {
    res.json(
      await updateSubmission(eventContext(req), currentUser(req), req.body, req.ipHash),
    );
  }),
);

router.post(
  "/mine/submit",
  requireAuth,
  asyncHandler(loadEventContext),
  writeRateLimit,
  asyncHandler(async (req, res) => {
    res.json(await submitSubmission(eventContext(req), currentUser(req), req.ipHash));
  }),
);

router.post(
  "/mine/withdraw",
  requireAuth,
  asyncHandler(loadEventContext),
  writeRateLimit,
  asyncHandler(async (req, res) => {
    res.json(await withdrawSubmission(eventContext(req), currentUser(req), req.ipHash));
  }),
);

/**
 * The edit trail for the caller's own submission, read out of the audit log so
 * history and audit can never disagree.
 */
router.get(
  "/mine/history",
  requireAuth,
  asyncHandler(loadEventContext),
  asyncHandler(async (req, res) => {
    const ctx = eventContext(req);
    const submission = await getMySubmission(ctx, currentUser(req).id);
    if (!submission) {
      res.json([]);
      return;
    }

    const entries = await prisma.auditLog.findMany({
      where: {
        eventId: ctx.event.id,
        targetType: "submission",
        targetId: submission.id,
      },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: { id: true, action: true, summary: true, createdAt: true, metadata: true },
    });
    res.json(entries);
  }),
);

/** Organizer view: every entry including drafts. */
router.get(
  "/all",
  requireAuth,
  asyncHandler(loadEventContext),
  requireEventAdmin,
  asyncHandler(async (req, res) => {
    res.json(
      await prisma.submission.findMany({
        where: { eventId: eventContext(req).event.id },
        include: {
          team: { select: { id: true, name: true } },
          track: { select: { id: true, name: true } },
          _count: { select: { scores: true, assignments: true } },
        },
        orderBy: { createdAt: "asc" },
      }),
    );
  }),
);

router.post(
  "/:submissionId/lock",
  requireAuth,
  asyncHandler(loadEventContext),
  requireEventAdmin,
  validate({ body: z.object({ locked: z.boolean() }) }),
  asyncHandler(async (req, res) => {
    res.json(
      await setSubmissionLock(
        eventContext(req),
        req.params.submissionId as string,
        req.body.locked,
        req.ipHash,
      ),
    );
  }),
);

router.get(
  "/:submissionId",
  asyncHandler(loadEventContext),
  asyncHandler(async (req, res) => {
    res.json(await getGalleryEntry(eventContext(req), req.params.submissionId as string));
  }),
);

export default router;
