import {
  EventMode,
  EventRole,
  EventStatus,
  EventVisibility,
  NormalizationMethod,
  PrismaClient,
  SubmissionStatus,
  TeamRole,
  UpdateTag,
  VotingAccess,
  VotingMethod,
} from "@prisma/client";
import { buildEventContext } from "../src/services/authorization.service.js";
import { publishResults, runNormalization } from "../src/services/results.service.js";

/**
 * Extra demo events so every status, visibility and role has something to open. The first
 * event (podium-26, in judging) lives in seed.ts. Everything here is built from the same
 * accounts, so one person is a participant in one event and a judge in another, which is
 * the event-scoped role model made visible. Idempotent: skipped when "harbor-hack" exists.
 */

const days = (n: number) => new Date(Date.now() + n * 24 * 60 * 60 * 1000);

const CRITERIA = [
  { key: "impact", label: "Impact", weight: 40, hint: "Would anyone outside this room use it?" },
  { key: "craft", label: "Craft", weight: 35, hint: "Does it hold up when you poke at it?" },
  { key: "demo", label: "Demo quality", weight: 25, hint: "Was the value legible quickly?" },
];

const TRACKS = ["Web", "Data"];

interface Project {
  team: string;
  name: string;
  tagline: string;
  members: string[];
  tags: string[];
  status?: SubmissionStatus;
}

const P = {
  kilnstack: { team: "Kilnstack", name: "Kilnstack", tagline: "Reproducible builds you can read.", members: ["marguerite@driftwatch.dev", "uwem@driftwatch.dev"], tags: ["build", "cache"] },
  draftwork: { team: "Draftwork", name: "Draftwork", tagline: "A writing tool that keeps every revision honest.", members: ["saoirse@quorumci.dev", "tobias@quorumci.dev"], tags: ["editor"], status: SubmissionStatus.DRAFT },
  latticeA: { team: "Lattice Crew", name: "Lattice", tagline: "Graph views for service dependencies.", members: ["anouk@sievebox.dev", "priyansh@sievebox.dev"], tags: ["graph", "ops"] },
  quiet: { team: "Hush", name: "Hush", tagline: "Private notes that sync without a server.", members: ["ingrid@parsely.dev", "chidi@parsely.dev"], tags: ["local-first"] },
} satisfies Record<string, Project>;

const SCORED: Project[] = [
  { team: "Alder", name: "Alder", tagline: "Feature flags with an audit trail.", members: ["anouk@sievebox.dev", "priyansh@sievebox.dev"], tags: ["flags"] },
  { team: "Birch", name: "Birch", tagline: "Log search that runs in the browser.", members: ["marguerite@driftwatch.dev", "uwem@driftwatch.dev"], tags: ["logs", "wasm"] },
  { team: "Cedar", name: "Cedar", tagline: "Schema-first mock servers.", members: ["saoirse@quorumci.dev", "tobias@quorumci.dev"], tags: ["api", "mock"] },
  { team: "Dune", name: "Dune", tagline: "Cost dashboards for small teams.", members: ["ingrid@parsely.dev", "chidi@parsely.dev"], tags: ["finops"] },
];

// One row per judge, one value per project in SCORED order. Deliberately different scales.
const JUDGE_SCALES: Record<string, number[]> = {
  "odalys@verdanto.io": [4, 3, 2, 5],
  "ferenc@kilnworks.io": [8, 6, 5, 9],
  "wren@tidepool.dev": [6, 7, 4, 7],
};

interface EventSpec {
  slug: string;
  name: string;
  tagline: string;
  status: EventStatus;
  visibility: EventVisibility;
  ownerEmail: string;
  coAdmins: string[];
  judges: string[];
  dates: {
    regOpen: number;
    regClose: number;
    subOpen: number;
    deadline: number;
    judgingClose: number;
    votingClose?: number;
  };
}

export async function seedShowcase(prisma: PrismaClient): Promise<void> {
  if (await prisma.event.findUnique({ where: { slug: "harbor-hack" }, select: { id: true } })) {
    console.log("[seed] showcase events already present");
    return;
  }

  const userRows = await prisma.user.findMany({ select: { id: true, email: true, name: true, isOrganizer: true, isSuperAdmin: true } });
  const users = new Map(userRows.map((u) => [u.email, u]));
  const id = (email: string) => {
    const u = users.get(email);
    if (!u) throw new Error(`showcase seed needs account ${email}`);
    return u.id;
  };

  async function createEvent(spec: EventSpec) {
    const ownerId = id(spec.ownerEmail);
    const event = await prisma.event.create({
      data: {
        slug: spec.slug,
        name: spec.name,
        tagline: spec.tagline,
        description: `${spec.name} is a demo event in the "${spec.status}" state with ${spec.visibility.toLowerCase()} visibility. It exists so every screen and role has real data to open.`,
        themeTags: ["Demo", "Open source"],
        mode: EventMode.ONLINE,
        eligibility: "Open to all",
        status: spec.status,
        visibility: spec.visibility,
        ownerId,
        registrationOpensAt: days(spec.dates.regOpen),
        registrationClosesAt: days(spec.dates.regClose),
        submissionsOpenAt: days(spec.dates.subOpen),
        submissionDeadline: days(spec.dates.deadline),
        judgingOpensAt: days(spec.dates.deadline),
        judgingClosesAt: days(spec.dates.judgingClose),
        votingClosesAt: spec.dates.votingClose !== undefined ? days(spec.dates.votingClose) : null,
        reviewsPerSubmission: 3,
        maxTeamSize: 4,
        memberships: {
          create: [
            { userId: ownerId, role: EventRole.ADMIN, acceptedAt: new Date() },
            ...spec.coAdmins.map((e) => ({ userId: id(e), role: EventRole.ADMIN, acceptedAt: new Date(), invitedById: ownerId })),
            ...spec.judges.map((e) => ({ userId: id(e), role: EventRole.JUDGE, acceptedAt: new Date(), invitedById: ownerId })),
          ],
        },
        tracks: { create: TRACKS.map((name, i) => ({ name, slug: name.toLowerCase(), position: i, description: `${name} projects.` })) },
        prizes: { create: [{ title: "Grand prize", amountCents: 250_000, position: 0 }, { title: "Best demo", amountCents: 50_000, position: 1 }] },
        rubric: { create: { name: `${spec.name} rubric`, criteria: { create: CRITERIA.map((c, i) => ({ ...c, position: i })) } } },
      },
      include: { tracks: true },
    });
    return event;
  }

  async function addTeams(eventId: string, trackId: string, projects: Project[], opts: { submitted?: boolean } = {}) {
    for (const project of projects) {
      const team = await prisma.team.create({
        data: {
          eventId,
          name: project.team,
          members: { create: project.members.map((email, i) => ({ userId: id(email), role: i === 0 ? TeamRole.OWNER : TeamRole.MEMBER })) },
        },
      });
      for (const email of project.members) {
        await prisma.eventMembership.upsert({
          where: { eventId_userId_role: { eventId, userId: id(email), role: EventRole.PARTICIPANT } },
          update: {},
          create: { eventId, userId: id(email), role: EventRole.PARTICIPANT, acceptedAt: new Date() },
        });
      }
      const status = project.status ?? (opts.submitted === false ? SubmissionStatus.DRAFT : SubmissionStatus.SUBMITTED);
      await prisma.submission.create({
        data: {
          eventId,
          teamId: team.id,
          trackId,
          name: project.name,
          tagline: project.tagline,
          description: `${project.name}: ${project.tagline} Built over a weekend, with notes on what is finished and what is a sketch.`,
          repoUrl: `https://github.com/demo/${project.name.toLowerCase()}`,
          liveUrl: `https://${project.name.toLowerCase()}.example.dev`,
          techTags: project.tags,
          license: "MIT",
          status,
          submittedAt: status === SubmissionStatus.SUBMITTED ? days(-1) : null,
          declarations: { window: true, original: true, licence: true },
        },
      });
    }
  }

  async function scoreEvent(eventId: string) {
    const rubric = await prisma.rubric.findUniqueOrThrow({ where: { eventId }, include: { criteria: { orderBy: { position: "asc" } } } });
    const subs = await prisma.submission.findMany({ where: { eventId }, orderBy: { name: "asc" }, select: { id: true } });
    for (const [email, values] of Object.entries(JUDGE_SCALES)) {
      for (const [index, submission] of subs.entries()) {
        const raw = values[index];
        if (raw === undefined) continue;
        const max = raw > 5 ? 10 : 5;
        await prisma.judgeAssignment.create({ data: { eventId, judgeId: id(email), submissionId: submission.id, position: index } });
        const criterionScores = rubric.criteria.map((c, ci) => ({ criterionId: c.id, value: Math.min(c.maxScore, Math.max(c.minScore, Math.round((raw / max) * c.maxScore) - (ci % 2)) ) }));
        const total = (criterionScores.reduce((s, cs, ci) => s + ((cs.value - rubric.criteria[ci]!.minScore) / (rubric.criteria[ci]!.maxScore - rubric.criteria[ci]!.minScore)) * rubric.criteria[ci]!.weight, 0) / rubric.criteria.reduce((s, c) => s + c.weight, 0)) * 100;
        await prisma.judgeScore.create({
          data: { eventId, judgeId: id(email), submissionId: submission.id, weightedTotal: Math.round(total * 100) / 100, comment: "Read the repository and watched the demo.", criterionScores: { create: criterionScores } },
        });
      }
    }
    await prisma.rubric.update({ where: { id: rubric.id }, data: { lockedAt: new Date() } });
  }

  async function publish(slug: string, ownerEmail: string) {
    const owner = users.get(ownerEmail)!;
    const ctx = await buildEventContext(slug, { id: owner.id, email: owner.email, name: owner.name, isOrganizer: owner.isOrganizer, isSuperAdmin: owner.isSuperAdmin });
    await runNormalization(ctx, NormalizationMethod.ZSCORE);
    await publishResults(ctx, true);
  }

  console.log("[seed] showcase: draft, published, registration, submissions, private and link only events");

  // 1. Draft: private to its admins and invited judge, takes no registrations.
  const harbor = await createEvent({
    slug: "harbor-hack", name: "Harbor Hack", tagline: "A draft the organizer is still shaping.",
    status: EventStatus.DRAFT, visibility: EventVisibility.PUBLIC, ownerEmail: "emeline@podium.dev", coAdmins: [], judges: ["odalys@verdanto.io"],
    dates: { regOpen: 20, regClose: 30, subOpen: 30, deadline: 32, judgingClose: 38 },
  });
  void harbor;

  // 2. Published, registration not yet open.
  await createEvent({
    slug: "summit-open", name: "Summit Open", tagline: "Announced and listed. Registration opens next week.",
    status: EventStatus.PUBLISHED, visibility: EventVisibility.PUBLIC, ownerEmail: "emeline@podium.dev", coAdmins: ["rasmus@podium.dev"], judges: ["ferenc@kilnworks.io"],
    dates: { regOpen: 7, regClose: 21, subOpen: 22, deadline: 25, judgingClose: 30 },
  });

  // 3. Registration open: registered participants, a team looking for members, a seeker.
  const lattice = await createEvent({
    slug: "lattice-jam", name: "Lattice Jam", tagline: "Registration is open. Find a team or start one.",
    status: EventStatus.REGISTRATION_OPEN, visibility: EventVisibility.PUBLIC, ownerEmail: "emeline@podium.dev", coAdmins: ["rasmus@podium.dev"], judges: ["wren@tidepool.dev"],
    dates: { regOpen: -5, regClose: 6, subOpen: 7, deadline: 9, judgingClose: 14 },
  });
  await addTeams(lattice.id, lattice.tracks[0]!.id, [P.latticeA], { submitted: false });
  await prisma.team.updateMany({
    where: { eventId: lattice.id, name: "Lattice Crew" },
    data: { pitch: "Two of us on graph layout, need a backend and a designer.", needs: ["backend", "design"], skills: ["graph", "ops"], boardTrackId: lattice.tracks[0]!.id, lookingForMembers: true },
  });
  for (const email of ["bertrand@oyelaran.dev", "junlan@wei.dev", "tabitha@meridian.dev"]) {
    await prisma.eventMembership.create({ data: { eventId: lattice.id, userId: id(email), role: EventRole.PARTICIPANT, acceptedAt: new Date() } });
    await prisma.registration.create({
      data: { eventId: lattice.id, userId: id(email), currentRole: "Engineer", skills: ["typescript"], trackId: lattice.tracks[0]!.id, shareProfile: true, rulesAcceptedAt: new Date(), conductAcceptedAt: new Date() },
    });
  }
  await prisma.seekerListing.create({
    data: { eventId: lattice.id, userId: id("bertrand@oyelaran.dev"), trackId: lattice.tracks[0]!.id, pitch: "Backend and on-call tooling. Looking for a team with a clear idea.", skills: ["ruby", "slack"] },
  }).catch(() => undefined);

  // 4. Submissions open, link only: a submitted project and a draft one.
  const kiln = await createEvent({
    slug: "kiln-sprint", name: "Kiln Sprint", tagline: "Link only. Teams are drafting and submitting.",
    status: EventStatus.SUBMISSIONS_OPEN, visibility: EventVisibility.UNLISTED, ownerEmail: "emeline@podium.dev", coAdmins: ["rasmus@podium.dev"], judges: ["ferenc@kilnworks.io", "guilhermina@northgale.io"],
    dates: { regOpen: -12, regClose: -2, subOpen: -6, deadline: 3, judgingClose: 8 },
  });
  await addTeams(kiln.id, kiln.tracks[0]!.id, [P.kilnstack, P.draftwork]);

  // 5. Private: owned by the instance operator, with the other organizer as co-admin.
  const quiet = await createEvent({
    slug: "quiet-room", name: "Quiet Room", tagline: "Private. Invisible to anyone without a role.",
    status: EventStatus.SUBMISSIONS_OPEN, visibility: EventVisibility.PRIVATE, ownerEmail: "rasmus@podium.dev", coAdmins: ["emeline@podium.dev"], judges: ["guilhermina@northgale.io"],
    dates: { regOpen: -10, regClose: -1, subOpen: -4, deadline: 5, judgingClose: 10 },
  });
  await addTeams(quiet.id, quiet.tracks[0]!.id, [P.quiet]);

  // 6. Voting: scored by three judges, a community ballot, comments and an update.
  const orbit = await createEvent({
    slug: "orbit-cup", name: "Orbit Cup", tagline: "Judging is done. The community vote is open.",
    status: EventStatus.VOTING, visibility: EventVisibility.PUBLIC, ownerEmail: "emeline@podium.dev", coAdmins: ["rasmus@podium.dev"], judges: Object.keys(JUDGE_SCALES),
    dates: { regOpen: -30, regClose: -14, subOpen: -20, deadline: -8, judgingClose: -3, votingClose: 4 },
  });
  await addTeams(orbit.id, orbit.tracks[0]!.id, SCORED);
  await scoreEvent(orbit.id);
  await prisma.votingConfig.create({
    data: { eventId: orbit.id, enabled: true, method: VotingMethod.SINGLE, access: VotingAccess.OPEN_LINK, hideResults: true, shuffleBallot: true },
  });
  const orbitSubs = await prisma.submission.findMany({ where: { eventId: orbit.id }, orderBy: { name: "asc" }, select: { id: true } });
  const voters = ["bertrand@oyelaran.dev", "junlan@wei.dev", "tabitha@meridian.dev"];
  for (const [i, email] of voters.entries()) {
    await prisma.vote.create({
      data: { eventId: orbit.id, submissionId: orbitSubs[i % orbitSubs.length]!.id, userId: id(email), voterKey: `user:${id(email)}`, weight: 1, credits: 1 },
    });
  }
  await prisma.comment.createMany({
    data: [
      { eventId: orbit.id, submissionId: orbitSubs[0]!.id, userId: id("bertrand@oyelaran.dev"), body: "The audit trail on flag changes is exactly what we lacked." },
      { eventId: orbit.id, submissionId: orbitSubs[1]!.id, userId: id("junlan@wei.dev"), body: "Ran the browser log search on a 200 MB file. Impressive." },
      { eventId: orbit.id, submissionId: orbitSubs[1]!.id, userId: id("tabitha@meridian.dev"), body: "Spam, please hide.", hiddenAt: new Date(), hiddenReason: "Off topic" },
    ],
  });
  await prisma.eventUpdate.create({
    data: { eventId: orbit.id, authorId: id("emeline@podium.dev"), title: "Voting is open", body: "Judging has closed. Cast your vote on the ballot before the window ends.", tag: UpdateTag.VOTING, pinned: true },
  });

  // 7 and 8. Results published, and archived. Both carry a stored normalization run.
  for (const spec of [
    { slug: "ledger-week", name: "Ledger Week", tagline: "Results are published. Raw and normalized side by side.", status: EventStatus.RESULTS_PUBLISHED, offset: -40 },
    { slug: "atlas-archive", name: "Atlas Archive", tagline: "An archived event, kept for the record.", status: EventStatus.ARCHIVED, offset: -120 },
  ]) {
    const ev = await createEvent({
      slug: spec.slug, name: spec.name, tagline: spec.tagline, status: spec.status, visibility: EventVisibility.PUBLIC,
      ownerEmail: "emeline@podium.dev", coAdmins: ["rasmus@podium.dev"], judges: Object.keys(JUDGE_SCALES),
      dates: { regOpen: spec.offset - 30, regClose: spec.offset - 14, subOpen: spec.offset - 20, deadline: spec.offset - 8, judgingClose: spec.offset - 3 },
    });
    await addTeams(ev.id, ev.tracks[0]!.id, SCORED);
    await scoreEvent(ev.id);
    await publish(spec.slug, "emeline@podium.dev");
    await prisma.event.update({ where: { id: ev.id }, data: { status: spec.status } });
  }

  console.log("[seed] showcase events: harbor-hack (draft), summit-open (published), lattice-jam (registration), kiln-sprint (link only), quiet-room (private), orbit-cup (voting), ledger-week (results), atlas-archive (archived)");
}
