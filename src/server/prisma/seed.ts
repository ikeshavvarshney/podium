import {
  EventRole,
  EventMode,
  EventStatus,
  PrismaClient,
  RoundKind,
  SubmissionStatus,
  TeamRole,
  UpdateTag,
  VotingAccess,
  VotingMethod,
} from "@prisma/client";
import { hashPassword } from "../src/lib/crypto.js";
import { loadDotEnv } from "../src/lib/dotenv.js";
import { seedFixtures } from "./seed-fixtures.js";
import { seedShowcase } from "./seed-showcase.js";

loadDotEnv();

const prisma = new PrismaClient();

/**
 * Deterministic demo data. Every account uses the same password so the README
 * can publish one credential line.
 */
const PASSWORD = "podium-demo-2026";

const days = (n: number) => new Date(Date.now() + n * 24 * 60 * 60 * 1000);

const PEOPLE = [
  { email: "emeline@podium.dev", name: "Emeline Fortescue-Adeyemi", organizer: true, org: "Event organizer", pronouns: "they/them" },
  { email: "rasmus@podium.dev", name: "Rasmus Oyelaran-Vik", organizer: true, org: "Instance administrator", pronouns: "he/him" },
  { email: "odalys@verdanto.io", name: "Odalys Mbeki-Trent", organizer: false, org: "Staff engineer, Verdanto", pronouns: "she/her" },
  { email: "ferenc@kilnworks.io", name: "Ferenc Halasz", organizer: false, org: "Platform lead, Kilnworks" },
  { email: "wren@tidepool.dev", name: "Wren Achebe-Sato", organizer: false, org: "Founder, Tidepool Labs" },
  { email: "guilhermina@northgale.io", name: "Guilhermina Rosario", organizer: false, org: "Principal SRE, Northgale" },
  { email: "anouk@sievebox.dev", name: "Anouk Lindqvist-Baror", organizer: false, org: "Team Sievebox", pronouns: "she/her" },
  { email: "priyansh@sievebox.dev", name: "Priyansh Deol", organizer: false, org: "Team Sievebox" },
  { email: "marguerite@driftwatch.dev", name: "Marguerite Achterberg", organizer: false, org: "Team Driftwatch" },
  { email: "uwem@driftwatch.dev", name: "Uwem Okafor-Lindqvist", organizer: false, org: "Team Driftwatch" },
  { email: "saoirse@quorumci.dev", name: "Saoirse Manzoor", organizer: false, org: "Team Quorum" },
  { email: "tobias@quorumci.dev", name: "Tobias Wendland", organizer: false, org: "Team Quorum" },
  { email: "ingrid@parsely.dev", name: "Ingrid Solheim-Baptiste", organizer: false, org: "Team Parsely" },
  { email: "chidi@parsely.dev", name: "Chidi Nakamura", organizer: false, org: "Team Parsely" },
  { email: "bertrand@oyelaran.dev", name: "Bertrand Oyelaran", organizer: false, org: "Independent" },
  { email: "junlan@wei.dev", name: "Junlan Wei", organizer: false, org: "Independent" },
  { email: "tabitha@meridian.dev", name: "Tabitha Onyekwere", organizer: false, org: "Research eng, Meridian" },
];

/** People registered without a team, listed on the board as looking for one. */
const SEEKERS = [
  { email: "bertrand@oyelaran.dev", track: "Tooling", pitch: "Ruby and on-call tooling. Happy to own the boring integration nobody wants.", skills: ["ruby", "slack", "oncall"] },
  { email: "junlan@wei.dev", track: "Tooling", pitch: "Graph layout and TypeScript. Want to work on developer orientation tools.", skills: ["typescript", "graph"] },
  { email: "tabitha@meridian.dev", track: "Agents", pitch: "Research engineer, interested in evaluation harnesses over model work.", skills: ["python", "eval"] },
];

/** What each seeded team still wants, shown on the board. */
const TEAM_NEEDS: Record<string, { pitch: string; needs: string[] }> = {
  Sievebox: { pitch: "Solo on an IMAP-side classifier, need a front-end and an evaluator.", needs: ["frontend", "evaluation"] },
  Driftwatch: { pitch: "Terraform drift diffs are working; looking for someone who enjoys provider APIs.", needs: ["backend", "aws"] },
};

const TRACKS = [
  { name: "Tooling", description: "Developer tools and workflow." },
  { name: "Agents", description: "Autonomous and assistive systems." },
  { name: "Infra", description: "Platform, storage and reliability." },
];

const CRITERIA = [
  { key: "impact", label: "Impact", weight: 30, hint: "Would anyone outside this room use it on Monday?" },
  { key: "craft", label: "Craft", weight: 25, hint: "Does the thing hold up when you poke at it?" },
  { key: "original", label: "Originality", weight: 20, hint: "Is the approach doing something new, or repackaging?" },
  { key: "demo", label: "Demo quality", weight: 15, hint: "Was the value legible in under five minutes?" },
  { key: "scope", label: "Scope fit", weight: 10, hint: "Was this a sane amount to attempt in a weekend?" },
];

const PROJECTS = [
  { team: "Sievebox", track: "Tooling", name: "Sievebox", tagline: "A spam filter you train by forwarding two emails.", tags: ["imap", "embeddings", "privacy"], members: ["anouk@sievebox.dev", "priyansh@sievebox.dev"] },
  { team: "Driftwatch", track: "Infra", name: "Driftwatch", tagline: "Catches schema drift before your migration does.", tags: ["postgres", "go", "cli"], members: ["marguerite@driftwatch.dev", "uwem@driftwatch.dev"] },
  { team: "Quorum", track: "Agents", name: "Quorum", tagline: "Three models review your pull request and argue about it.", tags: ["llm", "eval", "rust"], members: ["saoirse@quorumci.dev", "tobias@quorumci.dev"] },
  { team: "Parsely", track: "Tooling", name: "Parsely", tagline: "Turns a messy CSV into a typed schema you can trust.", tags: ["wasm", "cli", "eval"], members: ["ingrid@parsely.dev", "chidi@parsely.dev"] },
];

async function main(): Promise<void> {
  const alreadySeeded = await prisma.event.findUnique({
    where: { slug: "podium-26" },
    select: { id: true },
  });

  if (alreadySeeded && process.env.SEED_FORCE !== "true") {
    console.log("[seed] demo event already present, nothing to do (SEED_FORCE=true to rebuild)");
    await seedShowcase(prisma);
    await seedFixtures(prisma, () => hashPassword(PASSWORD));
    return;
  }

  if (alreadySeeded) {
    // Only ever removes what this script created; other data is left alone.
    console.log("[seed] rebuilding the demo event");
    await prisma.event.delete({ where: { id: alreadySeeded.id } });
    await prisma.user.deleteMany({ where: { email: { in: PEOPLE.map((p) => p.email) } } });
  }

  console.log("[seed] creating accounts");
  const passwordHash = await hashPassword(PASSWORD);
  const users = new Map<string, string>();
  for (const person of PEOPLE) {
    const user = await prisma.user.upsert({
      where: { email: person.email },
      update: {},
      create: {
        email: person.email,
        name: person.name,
        passwordHash,
        isOrganizer: person.organizer,
        isSuperAdmin: person.email === "rasmus@podium.dev",
        org: person.org,
        pronouns: person.pronouns ?? null,
      },
    });
    users.set(person.email, user.id);
  }

  const ownerId = users.get("emeline@podium.dev")!;

  console.log("[seed] creating event");
  const event = await prisma.event.create({
    data: {
      slug: "podium-26",
      name: "podium '26",
      tagline: "Seventy-two hours. One weekend. Build something that holds up.",
      description:
        "podium '26 is a weekend build event. Judging is blind and normalized: every submission is read by three independent judges against a published rubric, and scores are adjusted for judge severity before any ranking is shown.",
      themeTags: ["Infra", "Agents", "Tooling"],
      mode: EventMode.HYBRID,
      place: "Lisbon + online",
      eligibility: "Open to all",
      status: EventStatus.JUDGING,
      ownerId,
      registrationOpensAt: days(-30),
      registrationClosesAt: days(-3),
      submissionsOpenAt: days(-10),
      submissionDeadline: days(-1),
      judgingOpensAt: days(-1),
      judgingClosesAt: days(3),
      votingOpensAt: days(-1),
      votingClosesAt: days(6),
      reviewsPerSubmission: 3,
      maxTeamSize: 4,
      votingConfig: {
        create: {
          enabled: true,
          method: VotingMethod.QUADRATIC,
          access: VotingAccess.AUTHENTICATED,
          creditBudget: 20,
          hideResults: true,
          shuffleBallot: true,
        },
      },
      memberships: {
        create: [
          { userId: ownerId, role: EventRole.ADMIN, acceptedAt: new Date() },
          { userId: users.get("rasmus@podium.dev")!, role: EventRole.ADMIN, acceptedAt: new Date() },
        ],
      },
      tracks: {
        create: TRACKS.map((t, i) => ({
          name: t.name,
          slug: t.name.toLowerCase(),
          description: t.description,
          position: i,
        })),
      },
      prizes: {
        create: [
          { title: "Grand prize", amountCents: 1_000_000, position: 0, description: "Top of the normalized panel score." },
          { title: "Runner-up", amountCents: 400_000, position: 1 },
        ],
      },
      customQuestions: {
        create: [
          {
            prompt: "What surprised you?",
            helpText: "Something you learned the hard way.",
            position: 0,
            publicAnswer: true,
          },
        ],
      },
      rubric: {
        create: {
          name: "podium '26 rubric",
          criteria: {
            create: CRITERIA.map((c, i) => ({ ...c, position: i })),
          },
        },
      },
    },
    include: { tracks: true, customQuestions: true },
  });

  const trackByName = new Map(event.tracks.map((t) => [t.name, t.id]));

  console.log("[seed] creating judges");
  const judgeEmails = [
    "odalys@verdanto.io",
    "ferenc@kilnworks.io",
    "wren@tidepool.dev",
    "guilhermina@northgale.io",
  ];
  for (const email of judgeEmails) {
    await prisma.eventMembership.create({
      data: {
        eventId: event.id,
        userId: users.get(email)!,
        role: EventRole.JUDGE,
        invitedById: ownerId,
        acceptedAt: new Date(),
      },
    });
  }

  console.log("[seed] creating teams and submissions");
  for (const project of PROJECTS) {
    const team = await prisma.team.create({
      data: {
        eventId: event.id,
        name: project.team,
        members: {
          create: project.members.map((email, i) => ({
            userId: users.get(email)!,
            role: i === 0 ? TeamRole.OWNER : TeamRole.MEMBER,
          })),
        },
      },
    });

    for (const email of project.members) {
      await prisma.eventMembership.create({
        data: {
          eventId: event.id,
          userId: users.get(email)!,
          role: EventRole.PARTICIPANT,
          acceptedAt: new Date(),
        },
      });
    }

    await prisma.submission.create({
      data: {
        eventId: event.id,
        teamId: team.id,
        trackId: trackByName.get(project.track)!,
        name: project.name,
        tagline: project.tagline,
        description: `${project.name} is a weekend build. ${project.tagline} The repository contains the full implementation, a short demo recording, and notes on what is genuinely finished versus what is still a sketch.`,
        repoUrl: `https://github.com/team-${project.team.toLowerCase()}/${project.name.toLowerCase()}`,
        liveUrl: `https://${project.name.toLowerCase()}.example.dev`,
        techTags: project.tags,
        license: "MIT",
        status: SubmissionStatus.SUBMITTED,
        submittedAt: days(-1),
        declarations: { window: true, original: true, licence: true },
        answers: {
          create: [
            {
              questionId: event.customQuestions[0]!.id,
              value: "How much of the work was reading other people's edge cases rather than writing our own code.",
            },
          ],
        },
      },
    });
  }

  console.log("[seed] assigning judges and casting ballots");
  const rubric = await prisma.rubric.findUniqueOrThrow({
    where: { eventId: event.id },
    include: { criteria: { orderBy: { position: "asc" } } },
  });
  const submissions = await prisma.submission.findMany({
    where: { eventId: event.id },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });

  /**
   * Judge tendencies are deliberately different so the demo shows why
   * normalization exists: "harsh" and "generous" rank projects the same way but
   * on very different scales.
   */
  const TENDENCY: Record<string, Array<number | null>> = {
    // Per submission (alphabetical): Driftwatch, Parsely, Quorum, Sievebox.
    // null means this judge was not assigned that project, so the panels
    // overlap without being identical, which is what makes panel luck real.
    "odalys@verdanto.io": [4, 2, 3, null],
    "ferenc@kilnworks.io": [null, 4, 5, 5],
    "wren@tidepool.dev": [5, 1, null, 4],
    "guilhermina@northgale.io": [4, 3, 4, null],
  };

  for (const [email, values] of Object.entries(TENDENCY)) {
    const judgeId = users.get(email)!;

    for (const [index, submission] of submissions.entries()) {
      const value = values[index];
      if (value === undefined || value === null) continue;

      await prisma.judgeAssignment.create({
        data: { eventId: event.id, judgeId, submissionId: submission.id, position: index },
      });

      // Vary one criterion so no judge has a zero standard deviation.
      const criterionValues = rubric.criteria.map((criterion, ci) => ({
        criterionId: criterion.id,
        value: Math.min(
          criterion.maxScore,
          Math.max(criterion.minScore, value + (ci % 2 === 0 ? 0 : -1)),
        ),
      }));

      const weightSum = rubric.criteria.reduce((sum, c) => sum + c.weight, 0);
      const weighted =
        (criterionValues.reduce((sum, cv, ci) => {
          const criterion = rubric.criteria[ci]!;
          const span = criterion.maxScore - criterion.minScore;
          const fraction = span > 0 ? (cv.value - criterion.minScore) / span : 0;
          return sum + fraction * criterion.weight;
        }, 0) /
          weightSum) *
        100;

      await prisma.judgeScore.create({
        data: {
          eventId: event.id,
          judgeId,
          submissionId: submission.id,
          weightedTotal: Math.round(weighted * 100) / 100,
          comment: "Read the repository and watched the demo.",
          criterionScores: { create: criterionValues },
        },
      });
    }
  }

  await prisma.rubric.update({
    where: { id: rubric.id },
    data: { lockedAt: new Date() },
  });

  await prisma.auditLog.createMany({
    data: [
      {
        eventId: event.id,
        actorId: ownerId,
        action: "JUDGE_ASSIGNED",
        targetType: "event",
        targetId: event.id,
        summary: `${Object.keys(TENDENCY).length * submissions.length} judge assignments generated`,
      },
      {
        eventId: event.id,
        actorId: ownerId,
        action: "EVENT_CREATED",
        targetType: "event",
        targetId: event.id,
        summary: `Event "${event.name}" created`,
      },
    ],
  });

  // A realistic edit trail for one team, so the submission history and the
  // profile activity chart have something true to show.
  const sievebox = await prisma.submission.findFirstOrThrow({
    where: { eventId: event.id, name: "Sievebox" },
    select: { id: true },
  });
  const anouk = users.get("anouk@sievebox.dev")!;
  const edits = [
    { h: 11, summary: "Draft created" },
    { h: 10, summary: "Description edited" },
    { h: 8, summary: "Tag added: embeddings" },
    { h: 7, summary: "Repository link added" },
    { h: 5, summary: "Demo recording replaced" },
    { h: 4, summary: "Description edited" },
    { h: 3, summary: "Screenshot added" },
    { h: 2, summary: "Licence declared" },
    { h: 1, summary: "Submitted for judging" },
  ];
  await prisma.auditLog.createMany({
    data: edits.map((e) => ({
      eventId: event.id,
      actorId: anouk,
      action: e.summary.startsWith("Submitted") ? "SUBMISSION_SUBMITTED" : "SUBMISSION_UPDATED",
      targetType: "submission",
      targetId: sievebox.id,
      summary: `Sievebox: ${e.summary.toLowerCase()}`,
      createdAt: new Date(Date.now() - e.h * 60 * 60 * 1000),
    })),
  });

  console.log("[seed] listing the team board");
  for (const [teamName, listing] of Object.entries(TEAM_NEEDS)) {
    const project = PROJECTS.find((p) => p.team === teamName)!;
    await prisma.team.updateMany({
      where: { eventId: event.id, name: teamName },
      data: {
        pitch: listing.pitch,
        needs: listing.needs,
        skills: project.tags,
        boardTrackId: trackByName.get(project.track)!,
        lookingForMembers: true,
      },
    });
  }
  for (const seeker of SEEKERS) {
    const userId = users.get(seeker.email)!;
    await prisma.eventMembership.create({
      data: { eventId: event.id, userId, role: EventRole.PARTICIPANT, acceptedAt: new Date() },
    });
    await prisma.seekerListing.create({
      data: {
        eventId: event.id,
        userId,
        pitch: seeker.pitch,
        skills: seeker.skills,
        trackId: trackByName.get(seeker.track)!,
      },
    });
  }

  console.log("[seed] writing rounds and FAQ");
  await prisma.round.createMany({
    data: [
      {
        eventId: event.id,
        name: "Build & submit",
        kind: RoundKind.SUBMISSION,
        description: "Teams build and submit. Drafts stay editable until the deadline.",
        position: 0,
        opensAt: days(-10),
        closesAt: days(-1),
      },
      {
        eventId: event.id,
        name: "Judge scoring",
        kind: RoundKind.SCORING,
        description: "Three independent evaluations per project against the published rubric.",
        position: 1,
        opensAt: days(-1),
        closesAt: days(3),
        advances: 3,
      },
      {
        eventId: event.id,
        name: "Community vote",
        kind: RoundKind.VOTE,
        description: "Quadratic voting on the gallery. Tallies stay hidden until it closes.",
        position: 2,
        opensAt: days(-1),
        closesAt: days(6),
      },
    ],
  });
  await prisma.faqItem.createMany({
    data: [
      {
        eventId: event.id,
        question: "How is judging made fair across harsh and generous judges?",
        answer:
          "Every evaluation is standardized against the other evaluations that judge cast, then projects are re-ranked. Raw and normalized standings are published side by side.",
        position: 0,
      },
      {
        eventId: event.id,
        question: "Can I edit my submission after I submit it?",
        answer:
          "Yes, until the submission deadline. After that the server refuses edits, whatever the browser sends, and the rejected attempt is logged.",
        position: 1,
      },
      {
        eventId: event.id,
        question: "Can judges see each other's scores?",
        answer:
          "No. A judge reads only their own queue and their own evaluations. That boundary is enforced by the API, not hidden in the interface.",
        position: 2,
      },
    ],
  });

  console.log("[seed] writing speakers, mentors, partners and challenges");
  await prisma.eventPerson.createMany({
    data: [
      { eventId: event.id, kind: "MENTOR", name: "Aurelie Deschamps", role: "Distributed systems", org: "Northsill", position: 0 },
      { eventId: event.id, kind: "MENTOR", name: "Kwame Oyelaran", role: "Evaluation", org: "Quorum Labs", position: 1 },
      { eventId: event.id, kind: "SPEAKER", name: "Simone Falk", role: "Opening keynote", org: "Terrawatt", position: 2 },
      { eventId: event.id, kind: "MENTOR", name: "Hana Ishikawa", role: "Product and scoping", org: "Fiveline", position: 3 },
      { eventId: event.id, kind: "SPEAKER", name: "Rui Beltrao", role: "Judging criteria walkthrough", org: "podium Foundation", position: 4 },
      { eventId: event.id, kind: "MENTOR", name: "Dalia Haddad", role: "Security review", org: "Aperture Security", position: 5 },
    ],
  });
  await prisma.partner.createMany({
    data: [
      { eventId: event.id, name: "Northgale", tier: "Platinum sponsor", position: 0 },
      { eventId: event.id, name: "Verdanto", tier: "Infrastructure partner", position: 1 },
      { eventId: event.id, name: "Kilnworks", tier: "Community partner", position: 2 },
    ],
  });
  const embeddingsChallenge = await prisma.challenge.create({
    data: {
      eventId: event.id,
      sponsor: "Verdanto",
      name: "Best use of embeddings",
      brief: "Ship something that puts a vector index to genuine use, not a demo wrapper.",
      amountCents: 300000,
      currency: "USD",
      tags: ["ml", "search"],
      position: 0,
    },
  });
  await prisma.challenge.create({
    data: {
      eventId: event.id,
      sponsor: "Northgale",
      name: "Best reliability tooling",
      brief: "The most convincing case that this ships on-call toil, not just a dashboard.",
      amountCents: 250000,
      currency: "USD",
      tags: ["ops", "infra"],
      position: 1,
    },
  });
  const sieveboxSubmission = submissions.find((s) => s.name === "Sievebox");
  if (sieveboxSubmission) {
    await prisma.submission.update({
      where: { id: sieveboxSubmission.id },
      data: { challengeIds: [embeddingsChallenge.id] },
    });
  }

  console.log("[seed] casting community ballots");
  const voterTeams = new Map<string, string>();
  for (const project of PROJECTS) {
    for (const email of project.members) voterTeams.set(email, project.name);
  }

  // Each participant spends a 20-credit budget on projects other than their own,
  // which is exactly what the API would enforce on a live ballot.
  const spendPattern = [3, 2, 1];
  for (const [email, ownProject] of voterTeams) {
    const others = submissions.filter((s) => s.name !== ownProject).slice(0, spendPattern.length);
    await prisma.vote.createMany({
      data: others.map((submission, i) => ({
        eventId: event.id,
        submissionId: submission.id,
        userId: users.get(email)!,
        voterKey: `user:${users.get(email)!}`,
        weight: spendPattern[i]!,
        credits: spendPattern[i]! ** 2,
      })),
    });
  }

  const hoursAgo = (h: number) => new Date(Date.now() - h * 60 * 60 * 1000);
  await prisma.eventUpdate.createMany({
    data: [
      {
        eventId: event.id,
        authorId: ownerId,
        title: "Build round is live",
        body: "Submissions are open. Drafts stay editable until the deadline, and every edit is recorded.",
        tag: UpdateTag.ROUNDS,
        createdAt: hoursAgo(240),
      },
      {
        eventId: event.id,
        authorId: ownerId,
        title: "Submissions are closed",
        body: "The deadline has passed. Submissions are read-only from here; late edits are refused by the server.",
        tag: UpdateTag.DEADLINE,
        createdAt: hoursAgo(30),
      },
      {
        eventId: event.id,
        authorId: ownerId,
        title: "Community voting is open",
        body: "Every registered participant holds 20 credits. Backing a project with weight w costs w squared.",
        tag: UpdateTag.VOTING,
        createdAt: hoursAgo(20),
      },
      {
        eventId: event.id,
        authorId: ownerId,
        title: "Judging is open",
        body: "Judges, your queues are live. Every submission needs three independent evaluations before normalization publishes.",
        tag: UpdateTag.JUDGING,
        pinned: true,
        createdAt: hoursAgo(18),
      },
    ],
  });

  const ballots = await prisma.judgeScore.count({ where: { eventId: event.id } });
  console.log(
    `[seed] done. ${PEOPLE.length} accounts, ${PROJECTS.length} submissions, ${ballots} ballots.`,
  );
  await seedShowcase(prisma);
  await seedFixtures(prisma, () => hashPassword(PASSWORD));

  console.log(`[seed] every account signs in with the password: ${PASSWORD}`);
}

main()
  .catch((err) => {
    console.error("[seed] failed", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
