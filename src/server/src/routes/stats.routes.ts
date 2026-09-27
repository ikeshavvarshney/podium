import { EventStatus, EventVisibility, SubmissionStatus } from "@prisma/client";
import { Router } from "express";
import { prisma } from "../db.js";
import { asyncHandler } from "../lib/async-handler.js";

const router: Router = Router();

/**
 * Public counters for the landing page. Everything here is aggregate and
 * derived from public events only, so it leaks nothing the public could not
 * already read from the gallery.
 */
router.get(
  "/",
  asyncHandler(async (_req, res) => {
    const publicEvent = { visibility: EventVisibility.PUBLIC, status: { not: EventStatus.DRAFT } };

    const featured = await prisma.event.findFirst({
      where: publicEvent,
      orderBy: [{ resultsPublished: "desc" }, { submissionDeadline: "desc" }],
      select: {
        id: true,
        slug: true,
        name: true,
        reviewsPerSubmission: true,
        resultsPublished: true,
      },
    });

    const [events, submissions, judges, ballots, votes] = await Promise.all([
      prisma.event.count({ where: publicEvent }),
      prisma.submission.count({
        where: { status: SubmissionStatus.SUBMITTED, event: publicEvent },
      }),
      prisma.eventMembership.count({ where: { role: "JUDGE", event: publicEvent } }),
      prisma.judgeScore.count({ where: { event: publicEvent } }),
      prisma.vote.aggregate({ _sum: { weight: true }, where: { event: publicEvent } }),
    ]);

    const eventSubmissions = featured
      ? await prisma.submission.count({
          where: { eventId: featured.id, status: SubmissionStatus.SUBMITTED },
        })
      : 0;
    const eventJudges = featured
      ? await prisma.eventMembership.count({ where: { eventId: featured.id, role: "JUDGE" } })
      : 0;

    // The movement table only exists once an organizer has published a run.
    let movement: Array<{
      rank: number;
      rawRank: number;
      name: string;
      normalized: number;
      delta: number;
    }> = [];

    if (featured?.resultsPublished) {
      const run = await prisma.normalizationRun.findFirst({
        where: { eventId: featured.id },
        orderBy: { createdAt: "desc" },
        include: {
          scores: {
            orderBy: { normalizedRank: "asc" },
            take: 6,
            include: { submission: { select: { name: true } } },
          },
        },
      });
      movement =
        run?.scores.map((score) => ({
          rank: score.normalizedRank,
          rawRank: score.rawRank,
          name: score.submission.name,
          normalized: score.normalizedValue,
          delta: score.rawRank - score.normalizedRank,
        })) ?? [];
    }

    res.json({
      events,
      submissions,
      judges,
      ballots,
      votes: votes._sum.weight ?? 0,
      featured: featured
        ? {
            slug: featured.slug,
            name: featured.name,
            submissions: eventSubmissions,
            judges: eventJudges,
            reviewsPerSubmission: featured.reviewsPerSubmission,
            resultsPublished: featured.resultsPublished,
          }
        : null,
      movement,
    });
  }),
);

export default router;
