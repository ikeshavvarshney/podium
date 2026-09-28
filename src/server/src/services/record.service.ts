import { createHash } from "node:crypto";
import { prisma } from "../db.js";
import { conflict, forbidden } from "../lib/errors.js";
import { canonicalize, signPayload, signingPublicKey, verifyPayload } from "../lib/signing.js";
import type { EventContext } from "./authorization.service.js";

export interface JudgeRecordPayload {
  type: "podium.judge-participation.v1";
  instance: string;
  issuedAt: string;
  event: { slug: string; name: string; judgingClosedAt: string | null };
  judge: { id: string; name: string; org: string | null };
  /** Submission ids only: what was scored, never the scores themselves. */
  reviewed: string[];
  counts: { assigned: number; scored: number; skipped: number };
}

export interface SignedRecord {
  payload: JudgeRecordPayload;
  signature: string;
  hash: string;
  key: ReturnType<typeof signingPublicKey>;
}

/** Digest of the signed bytes, short enough to read out loud. */
function digest(payload: unknown): string {
  return createHash("sha256").update(canonicalize(payload)).digest("hex");
}

/** The earlier of the scheduled close and publication, ignoring dates still in the future. */
function closedAt(closesAt: Date | null, publishedAt: Date | null): Date | null {
  const now = Date.now();
  const candidates = [closesAt, publishedAt].filter((d): d is Date => d !== null && d.getTime() <= now);
  if (candidates.length === 0) return null;
  return candidates.reduce((a, b) => (a < b ? a : b));
}

/**
 * A judge's dated attestation of the projects they evaluated. It is issued only
 * once judging has closed, because a record of an unfinished queue would
 * attest to something still moving.
 */
export async function buildJudgeRecord(ctx: EventContext, judgeId: string): Promise<SignedRecord> {
  if (!ctx.isJudge) throw forbidden("Only a judge on this event may draw their own record.");

  const closesAt = ctx.event.judgingClosesAt;
  const closed = Boolean(closesAt && closesAt.getTime() < Date.now()) || ctx.event.resultsPublished;
  if (!closed) {
    throw conflict(
      "Judging is still open for this event. A participation record is issued once the window closes.",
    );
  }

  const [judge, assignments, scores] = await Promise.all([
    prisma.user.findUniqueOrThrow({
      where: { id: judgeId },
      select: { id: true, name: true, org: true },
    }),
    prisma.judgeAssignment.findMany({
      where: { eventId: ctx.event.id, judgeId },
      select: { submissionId: true, skippedAt: true },
    }),
    prisma.judgeScore.findMany({
      where: { eventId: ctx.event.id, judgeId },
      select: { submissionId: true },
      orderBy: { submissionId: "asc" },
    }),
  ]);

  const payload: JudgeRecordPayload = {
    type: "podium.judge-participation.v1",
    instance: ctx.event.id,
    issuedAt: new Date().toISOString(),
    event: {
      slug: ctx.event.slug,
      name: ctx.event.name,
      judgingClosedAt: closedAt(closesAt, ctx.event.resultsPublishedAt)?.toISOString() ?? null,
    },
    judge: { id: judge.id, name: judge.name, org: judge.org },
    reviewed: scores.map((s) => s.submissionId),
    counts: {
      assigned: assignments.length,
      scored: scores.length,
      skipped: assignments.filter((a) => a.skippedAt !== null).length,
    },
  };

  return {
    payload,
    signature: signPayload(payload),
    hash: digest(payload),
    key: signingPublicKey(),
  };
}

/**
 * Public verification. Anyone holding a record can check it without an account,
 * which is what makes the attestation worth more than a certificate image.
 */
export function verifyRecord(record: { payload: unknown; signature: string }) {
  const valid = verifyPayload(record.payload, record.signature);
  return {
    valid,
    hash: digest(record.payload),
    key: signingPublicKey(),
    payload: valid ? record.payload : null,
  };
}
