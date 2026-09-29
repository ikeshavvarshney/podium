import { createHash } from "node:crypto";
import {
  EventMode,
  EventRole,
  EventStatus,
  EventVisibility,
  type PrismaClient,
  SubmissionStatus,
  TeamRole,
} from "@prisma/client";
import { z } from "zod";
import { weightedTotal } from "../algorithms/scoring.js";
import { AuditAction, recordAudit } from "./audit.service.js";

/**
 * Loads the organisers' fixtures.json (the shared DOGFOOD data set) into the normal schema.
 * The file is input, not a data model: fixture ids are used only to join records while
 * importing and are not stored. Everything lands in the same tables a real event uses, so
 * every screen, export and algorithm runs on it unchanged.
 */

const id = z.string().min(1);

export const fixtureSchema = z.object({
  event: z.object({ id, name: z.string().min(1), submissions_close: z.string().datetime() }),
  tracks: z.array(z.object({ id, name: z.string().min(1) })),
  judges: z.array(
    z.object({ id, name: z.string().min(1), email: z.string().email(), tracks: z.array(id).default([]) }),
  ),
  teams: z.array(z.object({ id, name: z.string().min(1), members: z.array(z.string().email()).min(1) })),
  projects: z.array(
    z.object({
      id,
      team: id,
      track: id.nullish(),
      title: z.string().min(1),
      summary: z.string().nullish(),
      repo_url: z.string().url().nullish(),
      submitted_at: z.string().datetime(),
    }),
  ),
  scores: z.array(
    z.object({
      judge: id,
      project: id,
      criteria: z.record(z.string(), z.number().int()),
      comment: z.string().nullish(),
    }),
  ),
});

export type Fixture = z.infer<typeof fixtureSchema>;

/** Fixture criteria carry no range, so they are read on the platform's default 1 to 5 scale. */
export const FIXTURE_SCORE_MIN = 1;
export const FIXTURE_SCORE_MAX = 5;

/**
 * A stable account id derived from the email, so a reseed produces the same ids and the
 * checker tokens and routes written into .dogfood.toml keep working.
 */
export function stableUserId(email: string): string {
  const h = createHash("sha256").update(`podium-fixture:${email.toLowerCase()}`).digest("hex");
  const variant = ((parseInt(h[16]!, 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** "priya1@example.org" becomes "Priya1". Fixture members carry an email and nothing else. */
function nameFromEmail(email: string): string {
  const local = email.split("@")[0]!;
  return local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part[0]!.toUpperCase() + part.slice(1))
    .join(" ");
}

/** Integer weights that total exactly 100, shared as evenly as integers allow. */
export function evenWeights(count: number): number[] {
  const base = Math.floor(100 / count);
  return Array.from({ length: count }, (_, i) => base + (i < 100 - base * count ? 1 : 0));
}

export interface SkippedRecord {
  kind: "project" | "score";
  id: string;
  reason: string;
}

export interface FixturePlan {
  slug: string;
  criteria: { key: string; weight: number }[];
  /** Projects to import: the earliest entry per team, since a team holds one submission. */
  projects: Fixture["projects"];
  scores: Fixture["scores"];
  /** Team names made unique within the event: fixture team id to the name stored. */
  teamNames: Map<string, string>;
  renamed: { id: string; from: string; to: string }[];
  skipped: SkippedRecord[];
}

/**
 * The pure part of the import: decides what goes in and what is refused, without a database.
 *
 * - A team holds one submission, the same rule the API enforces with a 409. When a team
 *   appears twice, the earlier entry is kept and the later one is refused as a duplicate,
 *   along with any ballots cast on it.
 * - A ballot for an unknown judge or project, a repeat ballot, or a value outside 1 to 5 is
 *   refused rather than coerced.
 * - Team names are unique within an event. Distinct teams sharing a name keep it for the
 *   first and get the fixture id appended for the rest, so nobody is merged by accident.
 * - Missing ballots are not invented. A project with two reviews next to one with five is
 *   imported as it is; normalization and the progress dashboard handle the gap.
 */
export function planFixtureImport(fixture: Fixture): FixturePlan {
  const skipped: SkippedRecord[] = [];
  const teamIds = new Set(fixture.teams.map((t) => t.id));
  const judgeIds = new Set(fixture.judges.map((j) => j.id));

  const byTeam = new Map<string, Fixture["projects"][number]>();
  const ordered = [...fixture.projects].sort((a, b) => a.submitted_at.localeCompare(b.submitted_at));
  for (const project of ordered) {
    if (!teamIds.has(project.team)) {
      skipped.push({ kind: "project", id: project.id, reason: `unknown team ${project.team}` });
      continue;
    }
    const first = byTeam.get(project.team);
    if (first) {
      skipped.push({
        kind: "project",
        id: project.id,
        reason: `duplicate submission: team ${project.team} already submitted ${first.id} ("${first.title}")`,
      });
      continue;
    }
    byTeam.set(project.team, project);
  }
  const kept = new Set([...byTeam.values()].map((p) => p.id));
  const projects = fixture.projects.filter((p) => kept.has(p.id));

  const criteriaKeys: string[] = [];
  for (const score of fixture.scores) {
    for (const key of Object.keys(score.criteria)) if (!criteriaKeys.includes(key)) criteriaKeys.push(key);
  }
  const weights = evenWeights(Math.max(criteriaKeys.length, 1));
  const criteria = criteriaKeys.map((key, i) => ({ key, weight: weights[i]! }));

  const seen = new Set<string>();
  const scores: Fixture["scores"] = [];
  for (const score of fixture.scores) {
    const ref = `${score.judge}/${score.project}`;
    if (!judgeIds.has(score.judge)) {
      skipped.push({ kind: "score", id: ref, reason: `unknown judge ${score.judge}` });
    } else if (!kept.has(score.project)) {
      skipped.push({ kind: "score", id: ref, reason: `project ${score.project} was not imported` });
    } else if (seen.has(ref)) {
      skipped.push({ kind: "score", id: ref, reason: "second ballot from the same judge" });
    } else if (criteriaKeys.some((k) => score.criteria[k] === undefined)) {
      skipped.push({ kind: "score", id: ref, reason: "ballot does not score every criterion" });
    } else if (Object.values(score.criteria).some((v) => v < FIXTURE_SCORE_MIN || v > FIXTURE_SCORE_MAX)) {
      skipped.push({ kind: "score", id: ref, reason: `a value is outside ${FIXTURE_SCORE_MIN} to ${FIXTURE_SCORE_MAX}` });
    } else {
      seen.add(ref);
      scores.push(score);
    }
  }

  const teamNames = new Map<string, string>();
  const renamed: FixturePlan["renamed"] = [];
  const taken = new Set<string>();
  for (const team of fixture.teams) {
    let name = team.name;
    if (taken.has(name.toLowerCase())) {
      name = `${team.name} (${team.id})`;
      renamed.push({ id: team.id, from: team.name, to: name });
    }
    taken.add(name.toLowerCase());
    teamNames.set(team.id, name);
  }

  return { slug: slugify(fixture.event.name), criteria, projects, scores, teamNames, renamed, skipped };
}

export interface FixtureImportResult {
  eventId: string;
  slug: string;
  submissions: number;
  ballots: number;
  renamed: FixturePlan["renamed"];
  skipped: SkippedRecord[];
}

/**
 * Writes the plan. Accounts are upserted by email (a stable id for new ones), so importing
 * next to existing users is safe; the event itself must not exist yet.
 */
export async function importFixture(
  db: PrismaClient,
  fixture: Fixture,
  opts: { ownerId: string; passwordHash: string },
): Promise<FixtureImportResult> {
  const plan = planFixtureImport(fixture);
  const close = new Date(fixture.event.submissions_close);
  const earliest = fixture.projects.reduce(
    (min, p) => Math.min(min, Date.parse(p.submitted_at)),
    close.getTime(),
  );
  const hour = 60 * 60 * 1000;
  const opensAt = new Date(Math.min(close.getTime() - 72 * hour, earliest - hour));

  const userIds = new Map<string, string>();
  async function account(email: string, name: string): Promise<string> {
    const key = email.toLowerCase();
    const known = userIds.get(key);
    if (known) return known;
    const user = await db.user.upsert({
      where: { email: key },
      update: {},
      create: { id: stableUserId(key), email: key, name, passwordHash: opts.passwordHash },
      select: { id: true },
    });
    userIds.set(key, user.id);
    return user.id;
  }

  const judgeUser = new Map<string, string>();
  for (const judge of fixture.judges) judgeUser.set(judge.id, await account(judge.email, judge.name));

  const event = await db.event.create({
    data: {
      slug: plan.slug,
      name: fixture.event.name,
      tagline: "The shared DOGFOOD fixture event, imported from fixtures.json.",
      description:
        "Imported from the organisers' fixtures.json. Submissions closed on the date in the file, so the event refuses new entries and edits.",
      themeTags: ["Fixture"],
      mode: EventMode.ONLINE,
      status: EventStatus.JUDGING,
      visibility: EventVisibility.PUBLIC,
      ownerId: opts.ownerId,
      registrationOpensAt: opensAt,
      registrationClosesAt: close,
      submissionsOpenAt: opensAt,
      submissionDeadline: close,
      judgingOpensAt: close,
      reviewsPerSubmission: 3,
      memberships: { create: [{ userId: opts.ownerId, role: EventRole.ADMIN, acceptedAt: close }] },
      tracks: {
        create: fixture.tracks.map((t, i) => ({ name: t.name, slug: slugify(t.name) || `track-${i + 1}`, position: i })),
      },
      rubric: {
        create: {
          name: "Fixture rubric",
          lockedAt: close,
          criteria: {
            create: plan.criteria.map((c, i) => ({
              key: c.key,
              label: c.key[0]!.toUpperCase() + c.key.slice(1),
              weight: c.weight,
              minScore: FIXTURE_SCORE_MIN,
              maxScore: FIXTURE_SCORE_MAX,
              position: i,
            })),
          },
        },
      },
    },
    include: { tracks: true, rubric: { include: { criteria: true } } },
  });

  const trackId = new Map(fixture.tracks.map((t, i) => [t.id, event.tracks.find((r) => r.position === i)!.id]));

  await db.eventMembership.createMany({
    data: fixture.judges.map((j) => ({
      eventId: event.id,
      userId: judgeUser.get(j.id)!,
      role: EventRole.JUDGE,
      invitedById: opts.ownerId,
      acceptedAt: close,
    })),
    skipDuplicates: true,
  });

  const teamId = new Map<string, string>();
  for (const team of fixture.teams) {
    const members: string[] = [];
    for (const email of team.members) members.push(await account(email, nameFromEmail(email)));
    const created = await db.team.create({
      data: {
        eventId: event.id,
        name: plan.teamNames.get(team.id)!,
        members: {
          create: [...new Set(members)].map((userId, i) => ({
            userId,
            role: i === 0 ? TeamRole.OWNER : TeamRole.MEMBER,
          })),
        },
      },
      select: { id: true },
    });
    teamId.set(team.id, created.id);
    await db.eventMembership.createMany({
      data: members.map((userId) => ({ eventId: event.id, userId, role: EventRole.PARTICIPANT, acceptedAt: close })),
      skipDuplicates: true,
    });
  }

  const submissionId = new Map<string, string>();
  for (const project of plan.projects) {
    const created = await db.submission.create({
      data: {
        eventId: event.id,
        teamId: teamId.get(project.team)!,
        trackId: project.track ? (trackId.get(project.track) ?? null) : null,
        name: project.title,
        tagline: project.summary ?? null,
        repoUrl: project.repo_url ?? null,
        status: SubmissionStatus.SUBMITTED,
        submittedAt: new Date(project.submitted_at),
        createdAt: new Date(project.submitted_at),
      },
      select: { id: true },
    });
    submissionId.set(project.id, created.id);
  }

  const criteria = event.rubric!.criteria;
  const position = new Map<string, number>();
  for (const score of plan.scores) {
    const judgeId = judgeUser.get(score.judge)!;
    const subId = submissionId.get(score.project)!;
    const values = criteria.map((c) => ({ criterionId: c.id, value: score.criteria[c.key]! }));
    const slot = position.get(judgeId) ?? 0;
    position.set(judgeId, slot + 1);

    await db.judgeAssignment.create({
      data: { eventId: event.id, judgeId, submissionId: subId, position: slot },
    });
    await db.judgeScore.create({
      data: {
        eventId: event.id,
        judgeId,
        submissionId: subId,
        weightedTotal: weightedTotal(criteria, values),
        comment: score.comment?.trim() || null,
        submittedAt: close,
        criterionScores: { create: values },
      },
    });
  }

  const refused = plan.skipped.map((s) => `${s.id} (${s.reason})`);
  const renamed = plan.renamed.map((r) => `${r.id} "${r.from}" stored as "${r.to}"`);
  await recordAudit(
    {
      action: AuditAction.BULK_IMPORT,
      eventId: event.id,
      actorId: opts.ownerId,
      targetType: "event",
      targetId: event.id,
      summary:
        `Imported fixtures.json: ${plan.projects.length} submissions, ${plan.scores.length} ballots, ` +
        `${fixture.judges.length} judges, ${fixture.teams.length} teams` +
        (refused.length ? `. Refused ${refused.length}: ${refused.join("; ")}` : "") +
        (renamed.length ? `. Renamed ${renamed.length} teams whose name was already taken: ${renamed.join("; ")}` : ""),
      metadata: {
        source: "fixtures.json",
        fixtureEventId: fixture.event.id,
        skipped: plan.skipped as never,
        renamed: plan.renamed as never,
      },
    },
    db,
  );

  return {
    eventId: event.id,
    slug: plan.slug,
    submissions: plan.projects.length,
    ballots: plan.scores.length,
    renamed: plan.renamed,
    skipped: plan.skipped,
  };
}
