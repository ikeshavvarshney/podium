import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "../db.js";

export const AuditAction = {
  USER_REGISTERED: "USER_REGISTERED",
  USER_LOGGED_IN: "USER_LOGGED_IN",
  USER_LOGIN_FAILED: "USER_LOGIN_FAILED",
  USER_LOGGED_OUT: "USER_LOGGED_OUT",
  USER_PROFILE_UPDATED: "USER_PROFILE_UPDATED",
  USER_PASSWORD_CHANGED: "USER_PASSWORD_CHANGED",
  USER_SESSIONS_REVOKED: "USER_SESSIONS_REVOKED",
  SIGN_IN_LINK_ISSUED: "SIGN_IN_LINK_ISSUED",

  EVENT_CREATED: "EVENT_CREATED",
  EVENT_UPDATED: "EVENT_UPDATED",
  EVENT_STATUS_CHANGED: "EVENT_STATUS_CHANGED",
  EVENT_UPDATE_POSTED: "EVENT_UPDATE_POSTED",
  ROUND_CHANGED: "ROUND_CHANGED",
  PERSON_CHANGED: "PERSON_CHANGED",
  PARTNER_CHANGED: "PARTNER_CHANGED",
  CHALLENGE_CHANGED: "CHALLENGE_CHANGED",
  BULK_IMPORT: "BULK_IMPORT",
  WEBHOOK_CHANGED: "WEBHOOK_CHANGED",
  FAQ_CHANGED: "FAQ_CHANGED",
  QUESTION_CHANGED: "QUESTION_CHANGED",
  EVENT_UPDATE_EDITED: "EVENT_UPDATE_EDITED",
  EVENT_UPDATE_DELETED: "EVENT_UPDATE_DELETED",

  ROLE_GRANTED: "ROLE_GRANTED",
  ROLE_REVOKED: "ROLE_REVOKED",
  MEMBER_REGISTERED: "MEMBER_REGISTERED",

  TRACK_CREATED: "TRACK_CREATED",
  TRACK_UPDATED: "TRACK_UPDATED",
  TRACK_DELETED: "TRACK_DELETED",
  PRIZE_CREATED: "PRIZE_CREATED",
  PRIZE_UPDATED: "PRIZE_UPDATED",
  PRIZE_DELETED: "PRIZE_DELETED",

  TEAM_CREATED: "TEAM_CREATED",
  TEAM_UPDATED: "TEAM_UPDATED",
  TEAM_MEMBER_ADDED: "TEAM_MEMBER_ADDED",
  TEAM_MEMBER_REMOVED: "TEAM_MEMBER_REMOVED",
  TEAM_INVITE_CREATED: "TEAM_INVITE_CREATED",
  TEAM_INVITE_REVOKED: "TEAM_INVITE_REVOKED",
  TEAM_INVITE_ACCEPTED: "TEAM_INVITE_ACCEPTED",
  TEAM_OWNER_TRANSFERRED: "TEAM_OWNER_TRANSFERRED",
  BOARD_LISTING_POSTED: "BOARD_LISTING_POSTED",
  JOIN_REQUESTED: "JOIN_REQUESTED",
  JOIN_REQUEST_DECIDED: "JOIN_REQUEST_DECIDED",

  SUBMISSION_CREATED: "SUBMISSION_CREATED",
  SUBMISSION_UPDATED: "SUBMISSION_UPDATED",
  SUBMISSION_SUBMITTED: "SUBMISSION_SUBMITTED",
  SUBMISSION_WITHDRAWN: "SUBMISSION_WITHDRAWN",
  SUBMISSION_LOCKED: "SUBMISSION_LOCKED",
  SUBMISSION_EDIT_REJECTED: "SUBMISSION_EDIT_REJECTED",

  RUBRIC_UPDATED: "RUBRIC_UPDATED",
  JUDGE_INVITED: "JUDGE_INVITED",
  JUDGE_ASSIGNED: "JUDGE_ASSIGNED",
  JUDGE_UNASSIGNED: "JUDGE_UNASSIGNED",
  ASSIGNMENT_SKIPPED: "ASSIGNMENT_SKIPPED",
  SCORE_SUBMITTED: "SCORE_SUBMITTED",
  RANKING_SUBMITTED: "RANKING_SUBMITTED",
  JUDGE_RECORD_ISSUED: "JUDGE_RECORD_ISSUED",
  SCORE_UPDATED: "SCORE_UPDATED",
  NORMALIZATION_RUN: "NORMALIZATION_RUN",
  RESULTS_PUBLISHED: "RESULTS_PUBLISHED",

  VOTING_CONFIGURED: "VOTING_CONFIGURED",
  VOTE_CAST: "VOTE_CAST",
  VOTE_REJECTED: "VOTE_REJECTED",
  COMMENT_POSTED: "COMMENT_POSTED",
  COMMENT_HIDDEN: "COMMENT_HIDDEN",

  ACCESS_DENIED: "ACCESS_DENIED",
} as const;

export type AuditActionKey = (typeof AuditAction)[keyof typeof AuditAction];

export interface AuditEntry {
  action: AuditActionKey;
  summary: string;
  eventId?: string | null;
  actorId?: string | null;
  targetType?: string | null;
  targetId?: string | null;
  metadata?: Prisma.InputJsonValue;
  ipHash?: string | null;
}

type Db = PrismaClient | Prisma.TransactionClient;

export async function recordAudit(entry: AuditEntry, db: Db = prisma): Promise<void> {
  await db.auditLog.create({
    data: {
      action: entry.action,
      summary: entry.summary,
      eventId: entry.eventId ?? null,
      actorId: entry.actorId ?? null,
      targetType: entry.targetType ?? null,
      targetId: entry.targetId ?? null,
      metadata: entry.metadata ?? {},
      ipHash: entry.ipHash ?? null,
    },
  });

  // Webhooks hang off the audit log so every notifiable action is, by
  // construction, also recorded. Delivery is detached from the request.
  if (entry.eventId) {
    const eventId = entry.eventId;
    setImmediate(() => {
      import("./webhook.service.js")
        .then(({ dispatchWebhooks }) =>
          dispatchWebhooks({
            action: entry.action,
            eventId,
            summary: entry.summary,
            targetType: entry.targetType ?? null,
            targetId: entry.targetId ?? null,
          }),
        )
        .catch((err) => console.error("[webhooks] dispatch failed", entry.action, err));
    });
  }
}

/** Audit failures must never break the request that triggered them. */
export function recordAuditSafe(entry: AuditEntry, db: Db = prisma): void {
  void recordAudit(entry, db).catch((err) => {
    console.error("[audit] failed to record entry", entry.action, err);
  });
}
