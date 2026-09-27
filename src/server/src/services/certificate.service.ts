import { EventRole, SubmissionStatus } from "@prisma/client";
import { createHash } from "node:crypto";
import { prisma } from "../db.js";
import { forbidden } from "../lib/errors.js";
import { canonicalize, signPayload, signingPublicKey } from "../lib/signing.js";
import type { EventContext } from "./authorization.service.js";

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

  const [holder, team, judgingCounts] = await Promise.all([
    prisma.user.findUniqueOrThrow({
      where: { id: ctx.user.id },
      select: { id: true, name: true, org: true },
    }),
    prisma.team.findFirst({
      where: { eventId: ctx.event.id, members: { some: { userId: ctx.user.id } } },
      select: {
        name: true,
        submission: { select: { name: true, status: true } },
      },
    }),
    ctx.roles.has(EventRole.JUDGE)
      ? Promise.all([
          prisma.judgeAssignment.count({ where: { eventId: ctx.event.id, judgeId: ctx.user.id } }),
          prisma.judgeScore.count({ where: { eventId: ctx.event.id, judgeId: ctx.user.id } }),
        ]).then(([assigned, scored]) => ({ assigned, scored }))
      : Promise.resolve(null),
  ]);

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
  };

  return {
    payload,
    signature: signPayload(payload),
    hash: createHash("sha256").update(canonicalize(payload)).digest("hex"),
    key: signingPublicKey(),
  };
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
