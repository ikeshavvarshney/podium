import { EventRole } from "@prisma/client";
import { Router } from "express";
import { prisma } from "../db.js";
import { asyncHandler } from "../lib/async-handler.js";
import { currentUser, requireAuth } from "../middleware/auth.js";

const router: Router = Router();

/**
 * Every event the caller runs: ones they own plus ones they hold the admin role
 * in. Drafts are included, because this is the organizer's own list, not the
 * public gallery.
 */
router.get(
  "/events",
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const events = await prisma.event.findMany({
      where: {
        OR: [
          { ownerId: user.id },
          { memberships: { some: { userId: user.id, role: EventRole.ADMIN } } },
        ],
      },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        slug: true,
        name: true,
        status: true,
        themeTags: true,
        updatedAt: true,
        registrationOpensAt: true,
        submissionsOpenAt: true,
        submissionDeadline: true,
        judgingClosesAt: true,
        votingClosesAt: true,
        _count: { select: { submissions: true } },
      },
    });

    const ids = events.map((e) => e.id);
    const roleCounts = await prisma.eventMembership.groupBy({
      by: ["eventId", "role"],
      where: { eventId: { in: ids } },
      _count: { _all: true },
    });
    const count = (eventId: string, role: EventRole) =>
      roleCounts.find((r) => r.eventId === eventId && r.role === role)?._count._all ?? 0;

    const now = Date.now();
    res.json(
      events.map((event) => {
        // Progress through the event's own timeline: how much of the window
        // between opening and the last configured close has elapsed.
        const start = (event.registrationOpensAt ?? event.submissionsOpenAt)?.getTime();
        const end = (event.votingClosesAt ?? event.judgingClosesAt ?? event.submissionDeadline)?.getTime();
        const progress =
          start && end && end > start ? Math.min(1, Math.max(0, (now - start) / (end - start))) : 0;

        return {
          id: event.id,
          slug: event.slug,
          name: event.name,
          status: event.status,
          themeTags: event.themeTags,
          updatedAt: event.updatedAt,
          submissionsOpenAt: event.submissionsOpenAt,
          submissionDeadline: event.submissionDeadline,
          registrations: count(event.id, EventRole.PARTICIPANT),
          judges: count(event.id, EventRole.JUDGE),
          submissions: event._count.submissions,
          progress,
        };
      }),
    );
  }),
);

export default router;
