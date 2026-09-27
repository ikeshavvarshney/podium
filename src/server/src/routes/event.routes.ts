import { EventMode, EventStatus, EventVisibility, Experience } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../lib/async-handler.js";
import { currentUser, requireAuth } from "../middleware/auth.js";
import {
  eventContext,
  loadEventContext,
  requireEventAdmin,
  requireOrganizerCapability,
} from "../middleware/event-context.js";
import { writeRateLimit } from "../middleware/rate-limit.js";
import { validate } from "../middleware/validate.js";
import {
  checkSlug,
  createEvent,
  getEventDetail,
  listPublicEvents,
  registerForEvent,
  updateEvent,
} from "../services/event.service.js";
import auditRoutes from "./audit.routes.js";
import boardRoutes from "./board.routes.js";
import exportRoutes from "./export.routes.js";
import integrationRoutes from "./integration.routes.js";
import judgingRoutes from "./judging.routes.js";
import memberRoutes from "./member.routes.js";
import prizeRoutes from "./prize.routes.js";
import challengeRoutes from "./challenge.routes.js";
import { personRoutes, partnerRoutes } from "./people.routes.js";
import { faqRoutes, roundRoutes } from "./schedule.routes.js";
import questionRoutes from "./question.routes.js";
import submissionRoutes from "./submission.routes.js";
import teamRoutes from "./team.routes.js";
import trackRoutes from "./track.routes.js";
import updateRoutes from "./update.routes.js";
import votingRoutes from "./voting.routes.js";

const router: Router = Router();

const dateish = z.coerce.date().nullish();

const timelineShape = {
  registrationOpensAt: dateish,
  registrationClosesAt: dateish,
  submissionsOpenAt: dateish,
  submissionDeadline: dateish,
  judgingOpensAt: dateish,
  judgingClosesAt: dateish,
  votingOpensAt: dateish,
  votingClosesAt: dateish,
};

const createEventSchema = z.object({
  name: z.string().trim().min(1, "An event name is required.").max(160),
  slug: z.string().trim().toLowerCase().max(60).optional(),
  tagline: z.string().trim().max(200).optional(),
  description: z.string().trim().max(20000).optional(),
  themeTags: z.array(z.string().trim().min(1).max(40)).max(12).optional(),
  visibility: z.nativeEnum(EventVisibility).optional(),
  timezone: z.string().trim().max(64).optional(),
  minTeamSize: z.number().int().min(1).max(20).optional(),
  maxTeamSize: z.number().int().min(1).max(20).optional(),
  eligibility: z.string().trim().max(120).optional(),
  mode: z.nativeEnum(EventMode).optional(),
  place: z.string().trim().max(160).nullish(),
  reviewsPerSubmission: z.number().int().min(1).max(20).optional(),
  ...timelineShape,
});

const updateEventSchema = createEventSchema.partial().extend({
  status: z.nativeEnum(EventStatus).optional(),
});

const registrationSchema = z
  .object({
    currentRole: z.string().trim().max(120).nullish(),
    experience: z.nativeEnum(Experience).nullish(),
    skills: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
    trackId: z.string().uuid().nullish(),
    shareProfile: z.boolean().optional(),
    acceptRules: z.boolean().optional(),
    acceptConduct: z.boolean().optional(),
    answers: z
      .array(z.object({ questionId: z.string().uuid(), value: z.string().max(4000) }))
      .max(50)
      .optional(),
  })
  .default({});

const listQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  status: z.nativeEnum(EventStatus).optional(),
  theme: z.string().trim().max(40).optional(),
  mode: z.nativeEnum(EventMode).optional(),
  eligibility: z.string().trim().max(120).optional(),
  sort: z.enum(["recent", "name", "deadline"]).optional(),
  take: z.coerce.number().int().min(1).max(100).optional(),
  skip: z.coerce.number().int().min(0).optional(),
});

router.get(
  "/",
  validate({ query: listQuerySchema }),
  asyncHandler(async (req, res) => {
    res.json(await listPublicEvents(req.query));
  }),
);

router.post(
  "/",
  requireAuth,
  requireOrganizerCapability,
  writeRateLimit,
  validate({ body: createEventSchema }),
  asyncHandler(async (req, res) => {
    const event = await createEvent(currentUser(req), req.body, req.ipHash);
    res.status(201).json(event);
  }),
);

// Declared before "/:eventId", which would otherwise read "slug-availability" as an event.
router.get(
  "/slug-availability",
  requireAuth,
  requireOrganizerCapability,
  validate({ query: z.object({ slug: z.string().trim().toLowerCase().max(80) }) }),
  asyncHandler(async (req, res) => {
    res.json(await checkSlug(req.query.slug as string));
  }),
);

router.get(
  "/:eventId",
  asyncHandler(loadEventContext),
  asyncHandler(async (req, res) => {
    res.json(await getEventDetail(eventContext(req)));
  }),
);

router.patch(
  "/:eventId",
  requireAuth,
  asyncHandler(loadEventContext),
  requireEventAdmin,
  writeRateLimit,
  validate({ body: updateEventSchema }),
  asyncHandler(async (req, res) => {
    res.json(await updateEvent(eventContext(req), req.body, req.ipHash));
  }),
);

router.post(
  "/:eventId/register",
  requireAuth,
  asyncHandler(loadEventContext),
  writeRateLimit,
  validate({ body: registrationSchema }),
  asyncHandler(async (req, res) => {
    const membership = await registerForEvent(
      eventContext(req),
      currentUser(req),
      req.body ?? {},
      req.ipHash,
    );
    res.status(201).json(membership);
  }),
);

router.use("/:eventId/tracks", trackRoutes);
router.use("/:eventId/prizes", prizeRoutes);
router.use("/:eventId/members", memberRoutes);
router.use("/:eventId/questions", questionRoutes);
router.use("/:eventId/teams", teamRoutes);
router.use("/:eventId/submissions", submissionRoutes);
router.use("/:eventId/updates", updateRoutes);
router.use("/:eventId/audit", auditRoutes);
router.use("/:eventId/board", boardRoutes);
router.use("/:eventId/rounds", roundRoutes);
router.use("/:eventId/faq", faqRoutes);
router.use("/:eventId/people", personRoutes);
router.use("/:eventId/partners", partnerRoutes);
router.use("/:eventId/challenges", challengeRoutes);
router.use("/:eventId", integrationRoutes);
router.use("/:eventId", votingRoutes);
router.use("/:eventId/export", exportRoutes);
router.use("/:eventId", judgingRoutes);

export default router;
