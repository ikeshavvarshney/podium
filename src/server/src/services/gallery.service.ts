import { Prisma, SubmissionStatus } from "@prisma/client";
import { prisma } from "../db.js";
import { notFound } from "../lib/errors.js";
import type { EventContext } from "./authorization.service.js";

export interface GalleryQuery {
  q?: string;
  track?: string;
  tag?: string;
  sort?: "recent" | "name" | "random";
  take?: number;
  skip?: number;
  seed?: number;
}

/** Deterministic shuffle, so a randomized gallery stays stable while paging. */
function seededShuffle<T>(items: T[], seed: number): T[] {
  let state = seed % 2147483647;
  if (state <= 0) state += 2147483646;
  const next = () => {
    state = (state * 16807) % 2147483647;
    return (state - 1) / 2147483646;
  };
  return items
    .map((value) => ({ value, key: next() }))
    .sort((a, b) => a.key - b.key)
    .map((x) => x.value);
}

const cardSelect = {
  id: true,
  name: true,
  tagline: true,
  thumbnailUrl: true,
  techTags: true,
  repoUrl: true,
  liveUrl: true,
  videoUrl: true,
  submittedAt: true,
  track: { select: { id: true, name: true, slug: true } },
  team: { select: { id: true, name: true } },
} as const;

/**
 * Public gallery. Only submitted entries are ever visible, so an unfinished
 * draft never leaks through search.
 */
export async function listGallery(ctx: EventContext, query: GalleryQuery) {
  const where: Prisma.SubmissionWhereInput = {
    eventId: ctx.event.id,
    status: SubmissionStatus.SUBMITTED,
  };

  if (query.q) {
    where.OR = [
      { name: { contains: query.q, mode: "insensitive" } },
      { tagline: { contains: query.q, mode: "insensitive" } },
      { description: { contains: query.q, mode: "insensitive" } },
      { techTags: { has: query.q.toLowerCase() } },
      { team: { name: { contains: query.q, mode: "insensitive" } } },
    ];
  }
  if (query.track) where.track = { slug: query.track };
  if (query.tag) where.techTags = { has: query.tag };

  const take = Math.min(query.take ?? 24, 100);
  const skip = query.skip ?? 0;

  if (query.sort === "random") {
    const all = await prisma.submission.findMany({ where, select: cardSelect });
    const shuffled = seededShuffle(all, query.seed ?? 42);
    return { items: shuffled.slice(skip, skip + take), total: all.length, take, skip };
  }

  const orderBy: Prisma.SubmissionOrderByWithRelationInput =
    query.sort === "name" ? { name: "asc" } : { submittedAt: "desc" };

  const [items, total] = await Promise.all([
    prisma.submission.findMany({ where, select: cardSelect, orderBy, take, skip }),
    prisma.submission.count({ where }),
  ]);

  return { items, total, take, skip };
}

export async function getGalleryEntry(ctx: EventContext, submissionId: string) {
  const submission = await prisma.submission.findFirst({
    where: { id: submissionId, eventId: ctx.event.id },
    include: {
      team: {
        select: {
          id: true,
          name: true,
          members: { select: { user: { select: { id: true, name: true, avatarHue: true } } } },
        },
      },
      track: { select: { id: true, name: true, slug: true } },
      images: { orderBy: { position: "asc" } },
      answers: { include: { question: true } },
    },
  });
  if (!submission) throw notFound("Submission not found.");

  const viewerOwns =
    !!ctx.user &&
    submission.team.members.some((m) => m.user.id === ctx.user?.id);
  const privileged = ctx.permissions.has("SUBMISSIONS") || ctx.isJudge || viewerOwns;

  // Drafts are visible only to their own team and to organizers.
  if (submission.status !== SubmissionStatus.SUBMITTED && !privileged) {
    throw notFound("Submission not found.");
  }

  return {
    ...submission,
    // Organizer-private questions stay hidden from the public gallery.
    answers: submission.answers.filter((a) => a.question.publicAnswer || privileged),
  };
}

/** Distinct tech tags across an event's submitted projects, for filter chips. */
export async function galleryFacets(ctx: EventContext) {
  const rows = await prisma.submission.findMany({
    where: { eventId: ctx.event.id, status: SubmissionStatus.SUBMITTED },
    select: { techTags: true, trackId: true },
  });

  const tagCounts = new Map<string, number>();
  for (const row of rows) {
    for (const tag of row.techTags) tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
  }

  const tracks = await prisma.track.findMany({
    where: { eventId: ctx.event.id },
    select: { id: true, name: true, slug: true },
    orderBy: { position: "asc" },
  });

  return {
    total: rows.length,
    tags: [...tagCounts.entries()]
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag)),
    tracks: tracks.map((t) => ({
      ...t,
      count: rows.filter((r) => r.trackId === t.id).length,
    })),
  };
}
