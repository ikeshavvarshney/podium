import { prisma } from "../db.js";
import type { EventContext } from "./authorization.service.js";

/**
 * RFC 4180 quoting. Text starting with =, +, -, @, tab or CR gets a leading quote so spreadsheets
 * do not run it as a formula; numbers are left as numbers.
 */
function cell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let text = String(value);
  const numeric =
    (typeof value === "number" && Number.isFinite(value)) || /^-?\d+(\.\d+)?$/.test(text);
  if (!numeric && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  const lines = [headers.map(cell).join(",")];
  for (const row of rows) lines.push(row.map(cell).join(","));
  return `${lines.join("\r\n")}\r\n`;
}

export async function exportSubmissions(ctx: EventContext): Promise<string> {
  const submissions = await prisma.submission.findMany({
    where: { eventId: ctx.event.id },
    include: {
      team: { select: { name: true, members: { include: { user: { select: { name: true, email: true } } } } } },
      track: { select: { name: true } },
      answers: { include: { question: { select: { prompt: true } } } },
    },
    orderBy: { createdAt: "asc" },
  });

  return toCsv(
    [
      "submission_id",
      "name",
      "tagline",
      "team",
      "members",
      "track",
      "status",
      "submitted_at",
      "repo_url",
      "live_url",
      "video_url",
      "tech_tags",
      "license",
    ],
    submissions.map((s) => [
      s.id,
      s.name,
      s.tagline,
      s.team.name,
      s.team.members.map((m) => `${m.user.name} <${m.user.email}>`).join("; "),
      s.track?.name ?? "",
      s.status,
      s.submittedAt?.toISOString() ?? "",
      s.repoUrl,
      s.liveUrl,
      s.videoUrl,
      s.techTags.join("; "),
      s.license,
    ]),
  );
}

export async function exportJudges(ctx: EventContext): Promise<string> {
  const judges = await prisma.eventMembership.findMany({
    where: { eventId: ctx.event.id, role: "JUDGE" },
    include: { user: { select: { id: true, name: true, email: true, org: true } } },
  });

  const [assignments, scores, tracks] = await Promise.all([
    prisma.judgeAssignment.groupBy({
      by: ["judgeId"],
      where: { eventId: ctx.event.id },
      _count: { _all: true },
    }),
    prisma.judgeScore.groupBy({
      by: ["judgeId"],
      where: { eventId: ctx.event.id },
      _count: { _all: true },
      _avg: { weightedTotal: true },
    }),
    prisma.track.findMany({ where: { eventId: ctx.event.id }, select: { id: true, name: true } }),
  ]);

  const trackName = new Map(tracks.map((t) => [t.id, t.name]));
  const assignedBy = new Map(assignments.map((a) => [a.judgeId, a._count._all]));
  const scoredBy = new Map(scores.map((s) => [s.judgeId, s]));

  return toCsv(
    ["judge_id", "name", "email", "org", "track_scope", "assigned", "completed", "mean_score"],
    judges.map((j) => {
      const stat = scoredBy.get(j.userId);
      return [
        j.userId,
        j.user.name,
        j.user.email,
        j.user.org ?? "",
        j.trackScope.map((id) => trackName.get(id) ?? id).join("; ") || "all tracks",
        assignedBy.get(j.userId) ?? 0,
        stat?._count._all ?? 0,
        stat?._avg.weightedTotal?.toFixed(2) ?? "",
      ];
    }),
  );
}

/** Every ballot, criterion by criterion, so the maths can be checked by hand. */
export async function exportScores(ctx: EventContext): Promise<string> {
  const scores = await prisma.judgeScore.findMany({
    where: { eventId: ctx.event.id },
    include: {
      judge: { select: { name: true, email: true } },
      submission: { select: { name: true, team: { select: { name: true } } } },
      criterionScores: { include: { criterion: { select: { key: true, label: true, weight: true } } } },
    },
    orderBy: { submittedAt: "asc" },
  });

  const rows: unknown[][] = [];
  for (const score of scores) {
    for (const criterion of score.criterionScores) {
      rows.push([
        score.submission.name,
        score.submission.team.name,
        score.judge.name,
        score.judge.email,
        criterion.criterion.key,
        criterion.criterion.label,
        criterion.criterion.weight,
        criterion.value,
        score.weightedTotal,
        score.comment ?? "",
        score.submittedAt.toISOString(),
      ]);
    }
  }

  return toCsv(
    [
      "submission",
      "team",
      "judge",
      "judge_email",
      "criterion_key",
      "criterion_label",
      "criterion_weight",
      "score",
      "ballot_weighted_total",
      "comment",
      "submitted_at",
    ],
    rows,
  );
}

export async function exportResults(ctx: EventContext, runId?: string): Promise<string> {
  const pinned = runId ?? ctx.event.publishedRunId;
  const run = pinned
    ? await prisma.normalizationRun.findFirst({ where: { id: pinned, eventId: ctx.event.id } })
    : await prisma.normalizationRun.findFirst({
        where: { eventId: ctx.event.id },
        orderBy: { createdAt: "desc" },
      });

  if (!run) return toCsv(["note"], [["No normalization run has been computed yet."]]);

  const scores = await prisma.normalizedScore.findMany({
    where: { runId: run.id },
    include: {
      submission: {
        select: { name: true, team: { select: { name: true } }, track: { select: { name: true } } },
      },
    },
    orderBy: { normalizedRank: "asc" },
  });

  return toCsv(
    [
      "normalized_rank",
      "raw_rank",
      "movement",
      "submission",
      "team",
      "track",
      "raw_mean",
      "normalized_value",
      "ballot_count",
      "method",
      "computed_at",
    ],
    scores.map((s) => [
      s.normalizedRank,
      s.rawRank,
      s.rawRank - s.normalizedRank,
      s.submission.name,
      s.submission.team.name,
      s.submission.track?.name ?? "",
      s.rawMean.toFixed(2),
      s.normalizedValue.toFixed(4),
      s.ballotCount,
      run.method,
      run.createdAt.toISOString(),
    ]),
  );
}

export async function exportTeams(ctx: EventContext): Promise<string> {
  const teams = await prisma.team.findMany({
    where: { eventId: ctx.event.id },
    include: {
      members: { include: { user: { select: { name: true, email: true } } } },
      submission: { select: { name: true, status: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  const rows: unknown[][] = [];
  for (const team of teams) {
    for (const member of team.members) {
      rows.push([
        team.name,
        member.user.name,
        member.user.email,
        member.role,
        team.submission?.name ?? "",
        team.submission?.status ?? "no submission",
      ]);
    }
  }

  return toCsv(
    ["team", "member_name", "member_email", "team_role", "submission", "submission_status"],
    rows,
  );
}

export async function exportAudit(ctx: EventContext): Promise<string> {
  const entries = await prisma.auditLog.findMany({
    where: { eventId: ctx.event.id },
    include: { actor: { select: { name: true, email: true } } },
    orderBy: { createdAt: "asc" },
  });

  return toCsv(
    ["timestamp", "action", "actor", "actor_email", "target_type", "target_id", "summary"],
    entries.map((e) => [
      e.createdAt.toISOString(),
      e.action,
      e.actor?.name ?? "system",
      e.actor?.email ?? "",
      e.targetType ?? "",
      e.targetId ?? "",
      e.summary,
    ]),
  );
}

/** Full event snapshot, for migrating an event out of this instance. */
export async function exportEventJson(ctx: EventContext) {
  const event = await prisma.event.findUniqueOrThrow({
    where: { id: ctx.event.id },
    include: {
      tracks: true,
      prizes: true,
      customQuestions: true,
      rubric: { include: { criteria: true } },
      memberships: { include: { user: { select: { email: true, name: true } } } },
      teams: {
        include: {
          members: { include: { user: { select: { email: true, name: true } } } },
        },
      },
      submissions: { include: { images: true, answers: true } },
      assignments: true,
      scores: { include: { criterionScores: true } },
      normalizationRuns: { include: { scores: true } },
      updates: true,
    },
  });

  return {
    exportedAt: new Date().toISOString(),
    formatVersion: 1,
    event,
  };
}
