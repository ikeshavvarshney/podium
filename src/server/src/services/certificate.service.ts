import { EventRole, EventStatus, SubmissionStatus } from "@prisma/client";
import { createHash } from "node:crypto";
import { prisma } from "../db.js";
import { forbidden } from "../lib/errors.js";
import { canonicalize, signPayload, signingPublicKey } from "../lib/signing.js";
import type { EventContext } from "./authorization.service.js";
import { getPublishedResults } from "./results.service.js";

export interface CertificatePayload {
  type: "podium.participation-certificate.v1";
  issuedAt: string;
  event: { slug: string; name: string };
  holder: { id: string; name: string; org: string | null };
  roles: string[];
  team: string | null;
  submission: string | null;
  /** For judges: how many projects they evaluated. Counts only, never the scores. */
  judging?: { assigned: number; scored: number };
  /** A top-three overall place, a track win, or both, from the published results. */
  award?: { place: number | null; track: string | null };
}

/**
 * A participation certificate for the caller, signed with the same instance
 * key as judge records, so a printed certificate carries a checkable code
 * rather than being an image anyone could fake.
 */
export async function buildMyCertificate(ctx: EventContext) {
  if (!ctx.user) throw forbidden("Sign in to draw a certificate.");
  if (ctx.roles.size === 0 && !ctx.isOwner) {
    throw forbidden("Certificates are issued to people who took part in this event.");
  }
  const finished = ctx.event.resultsPublished || ctx.event.status === EventStatus.ARCHIVED;
  if (!finished && !ctx.isEventAdmin) {
    throw forbidden("Certificates are issued once the winners are announced.");
  }

  const [holder, team, judgingCounts] = await Promise.all([
    prisma.user.findUniqueOrThrow({
      where: { id: ctx.user.id },
      select: { id: true, name: true, org: true },
    }),
    prisma.team.findFirst({
      where: { eventId: ctx.event.id, members: { some: { userId: ctx.user.id } } },
      select: {
        name: true,
        submission: { select: { id: true, name: true, status: true } },
      },
    }),
    ctx.roles.has(EventRole.JUDGE)
      ? Promise.all([
          prisma.judgeAssignment.count({ where: { eventId: ctx.event.id, judgeId: ctx.user.id } }),
          prisma.judgeScore.count({ where: { eventId: ctx.event.id, judgeId: ctx.user.id } }),
        ]).then(([assigned, scored]) => ({ assigned, scored }))
      : Promise.resolve(null),
  ]);

  const submitted = team?.submission?.status === SubmissionStatus.SUBMITTED ? team.submission : null;
  const award = submitted && (ctx.event.resultsPublished || ctx.permissions.has("RESULTS")) ? await awardFor(ctx, submitted.id) : null;

  const payload: CertificatePayload = {
    type: "podium.participation-certificate.v1",
    issuedAt: new Date().toISOString(),
    event: { slug: ctx.event.slug, name: ctx.event.name },
    holder,
    roles: [...ctx.roles].sort(),
    team: team?.name ?? null,
    submission:
      team?.submission && team.submission.status === SubmissionStatus.SUBMITTED
        ? team.submission.name
        : null,
    ...(judgingCounts ? { judging: judgingCounts } : {}),
    ...(award ? { award } : {}),
  };

  return {
    payload,
    signature: signPayload(payload),
    hash: createHash("sha256").update(canonicalize(payload)).digest("hex"),
    key: signingPublicKey(),
  };
}

/** The same rule as the winners page: top three overall, and the best-ranked entry in each track. */
async function awardFor(ctx: EventContext, submissionId: string) {
  const results = await getPublishedResults(ctx).catch(() => null);
  if (!results) return null;
  const mine = results.standings.find((s) => s.submission.id === submissionId);
  if (!mine) return null;
  const place = mine.rank <= 3 ? mine.rank : null;
  const trackName = mine.submission.track?.name ?? null;
  const trackWinner = trackName ? results.standings.find((s) => s.submission.track?.name === trackName) : undefined;
  const track = trackWinner?.submission.id === submissionId ? trackName : null;
  return place || track ? { place, track } : null;
}

/** Organizer view: how many certificates the event can issue, by role. */
export async function certificateSummary(ctx: EventContext) {
  const groups = await prisma.eventMembership.groupBy({
    by: ["role"],
    where: { eventId: ctx.event.id },
    _count: { _all: true },
  });
  const count = (role: EventRole) => groups.find((g) => g.role === role)?._count._all ?? 0;
  return {
    participants: count(EventRole.PARTICIPANT),
    judges: count(EventRole.JUDGE),
    admins: count(EventRole.ADMIN),
  };
}
