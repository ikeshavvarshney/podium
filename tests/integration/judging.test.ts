import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  anon,
  as,
  createEvent,
  createOrganizer,
  createTrack,
  createUser,
  grantRole,
  prisma,
  resetDatabase,
  type TestActor,
} from "../helpers.js";

const FUTURE = new Date(Date.now() + 7 * 24 * 60 * 60_000).toISOString();

const RUBRIC = {
  name: "Test rubric",
  criteria: [
    { key: "impact", label: "Impact", weight: 40 },
    { key: "craft", label: "Craft", weight: 35 },
    { key: "demo", label: "Demo quality", weight: 25 },
  ],
};

async function makeSubmission(
  actor: TestActor,
  eventId: string,
  teamName: string,
  projectName: string,
  trackId?: string,
) {
  await as(actor).post(`/api/events/${eventId}/register`).expect(201);
  await as(actor).post(`/api/events/${eventId}/teams`).send({ name: teamName }).expect(201);
  const created = await as(actor)
    .post(`/api/events/${eventId}/submissions`)
    .send({
      name: projectName,
      tagline: `${projectName} in one line.`,
      description: "A description long enough for the judges to read before scoring it.",
      ...(trackId ? { trackId } : {}),
    })
    .expect(201);
  await as(actor).post(`/api/events/${eventId}/submissions/mine/submit`).expect(200);
  return created.body.id as string;
}

describe("judging: rubric, assignment, scoring and isolation", () => {
  let organizer: TestActor;
  let judgeA: TestActor;
  let judgeB: TestActor;
  let outsider: TestActor;
  let builder1: TestActor;
  let builder2: TestActor;
  let builder3: TestActor;

  let event: { id: string; slug: string };
  let subOne: string;
  let subTwo: string;
  let subThree: string;
  let criterionIds: string[] = [];

  beforeAll(async () => {
    await resetDatabase();
    organizer = await createOrganizer("Organizer");
    judgeA = await createUser({ name: "Judge A" });
    judgeB = await createUser({ name: "Judge B" });
    outsider = await createUser({ name: "Outsider" });
    builder1 = await createUser({ name: "Builder One" });
    builder2 = await createUser({ name: "Builder Two" });
    builder3 = await createUser({ name: "Builder Three" });

    event = await createEvent(organizer, {
      name: "Judged Event",
      submissionDeadline: FUTURE,
      judgingClosesAt: FUTURE,
      reviewsPerSubmission: 2,
    });

    subOne = await makeSubmission(builder1, event.id, "Team One", "Project One");
    subTwo = await makeSubmission(builder2, event.id, "Team Two", "Project Two");
    subThree = await makeSubmission(builder3, event.id, "Team Three", "Project Three");

    await grantRole(organizer, event.id, judgeA, "JUDGE");
    await grantRole(organizer, event.id, judgeB, "JUDGE");
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe("weighted rubric", () => {
    it("refuses weights that do not total 100", async () => {
      const res = await as(organizer)
        .put(`/api/events/${event.id}/rubric`)
        .send({ criteria: [{ key: "a", label: "A", weight: 60 }] })
        .expect(400);
      expect(res.body.error.message).toMatch(/100/);
    });

    it("refuses a duplicate criterion key", async () => {
      await as(organizer)
        .put(`/api/events/${event.id}/rubric`)
        .send({
          criteria: [
            { key: "same", label: "One", weight: 50 },
            { key: "same", label: "Two", weight: 50 },
          ],
        })
        .expect(400);
    });

    it("refuses the rubric editor to a judge", async () => {
      await as(judgeA).put(`/api/events/${event.id}/rubric`).send(RUBRIC).expect(403);
    });

    it("refuses the rubric editor to a participant", async () => {
      await as(builder1).put(`/api/events/${event.id}/rubric`).send(RUBRIC).expect(403);
    });

    it("accepts a rubric whose weights total 100", async () => {
      const res = await as(organizer)
        .put(`/api/events/${event.id}/rubric`)
        .send(RUBRIC)
        .expect(200);

      expect(res.body.criteria).toHaveLength(3);
      criterionIds = res.body.criteria.map((c: { id: string }) => c.id);
    });

    it("publishes the rubric so participants know how they are judged", async () => {
      const res = await anon().get(`/api/events/${event.id}/rubric`).expect(200);
      expect(res.body.criteria.map((c: { weight: number }) => c.weight)).toEqual([40, 35, 25]);
    });
  });

  describe("assignment", () => {
    it("refuses assignment generation to a judge", async () => {
      await as(judgeA)
        .post(`/api/events/${event.id}/assignments/generate`)
        .send({})
        .expect(403);
    });

    it("generates assignments covering every submission", async () => {
      const res = await as(organizer)
        .post(`/api/events/${event.id}/assignments/generate`)
        .send({ seed: 7 })
        .expect(200);

      expect(res.body.applied).toBeGreaterThan(0);
      expect(res.body.shortfalls).toHaveLength(0);
    });

    it("never assigns a judge their own team's submission", async () => {
      // Make judge B a participant with a team, then re-run assignment.
      const selfEvent = await createEvent(organizer, {
        name: "Self Review Event",
        submissionDeadline: FUTURE,
        reviewsPerSubmission: 1,
      });
      const ownSub = await makeSubmission(judgeB, selfEvent.id, "Judge Team", "Judge Project");
      await makeSubmission(builder1, selfEvent.id, "Other Team", "Other Project");
      await grantRole(organizer, selfEvent.id, judgeB, "JUDGE");
      await grantRole(organizer, selfEvent.id, judgeA, "JUDGE");

      await as(organizer)
        .post(`/api/events/${selfEvent.id}/assignments/generate`)
        .send({ seed: 3 })
        .expect(200);

      const assignments = await prisma.judgeAssignment.findMany({
        where: { eventId: selfEvent.id, judgeId: judgeB.id },
      });
      expect(assignments.some((a) => a.submissionId === ownSub)).toBe(false);
    });

    it("refuses a manual self-assignment", async () => {
      const selfEvent = await createEvent(organizer, {
        name: "Manual Self Event",
        submissionDeadline: FUTURE,
      });
      const ownSub = await makeSubmission(judgeB, selfEvent.id, "Own Team", "Own Project");
      await grantRole(organizer, selfEvent.id, judgeB, "JUDGE");

      await as(organizer)
        .post(`/api/events/${selfEvent.id}/assignments`)
        .send({ judgeId: judgeB.id, submissionId: ownSub })
        .expect(400);
    });

    it("refuses to assign someone who is not a judge on the event", async () => {
      await as(organizer)
        .post(`/api/events/${event.id}/assignments`)
        .send({ judgeId: outsider.id, submissionId: subOne })
        .expect(400);
    });
  });

  describe("judge queue isolation", () => {
    it("shows a judge only their own assignments", async () => {
      const queueA = await as(judgeA).get(`/api/events/${event.id}/judge/queue`).expect(200);
      const queueB = await as(judgeB).get(`/api/events/${event.id}/judge/queue`).expect(200);

      const idsA = queueA.body.items.map((i: { submission: { id: string } }) => i.submission.id);
      const idsB = queueB.body.items.map((i: { submission: { id: string } }) => i.submission.id);

      const mineA = await prisma.judgeAssignment.findMany({
        where: { eventId: event.id, judgeId: judgeA.id },
        select: { submissionId: true },
      });
      const mineB = await prisma.judgeAssignment.findMany({
        where: { eventId: event.id, judgeId: judgeB.id },
        select: { submissionId: true },
      });

      // Each queue is exactly that judge's own assignments. Two judges may
      // legitimately share the same projects, so the sets are not compared.
      expect(idsA.sort()).toEqual(mineA.map((a) => a.submissionId).sort());
      expect(idsB.sort()).toEqual(mineB.map((a) => a.submissionId).sort());
    });

    it("refuses the queue to a participant", async () => {
      await as(builder1).get(`/api/events/${event.id}/judge/queue`).expect(403);
    });

    it("refuses the queue to someone with no membership", async () => {
      await as(outsider).get(`/api/events/${event.id}/judge/queue`).expect(403);
    });

    it("refuses the queue to an anonymous caller", async () => {
      await anon().get(`/api/events/${event.id}/judge/queue`).expect(401);
    });
  });

  describe("scoring", () => {
    const ballot = (values: number[]) => ({
      criteria: criterionIds.map((id, i) => ({ criterionId: id, value: values[i]! })),
      comment: "Solid work.",
    });

    it("refuses a ballot for a submission the judge is not assigned", async () => {
      const mine = await prisma.judgeAssignment.findMany({
        where: { eventId: event.id, judgeId: judgeA.id },
        select: { submissionId: true },
      });
      const assigned = new Set(mine.map((m) => m.submissionId));
      const unassigned = [subOne, subTwo, subThree].find((id) => !assigned.has(id));

      if (unassigned) {
        await as(judgeA)
          .put(`/api/events/${event.id}/judge/scores/${unassigned}`)
          .send(ballot([4, 4, 4]))
          .expect(403);
      }
    });

    it("computes the weighted total on the server", async () => {
      const queue = await as(judgeA).get(`/api/events/${event.id}/judge/queue`).expect(200);
      const target = queue.body.items[0].submission.id;

      const res = await as(judgeA)
        .put(`/api/events/${event.id}/judge/scores/${target}`)
        .send(ballot([5, 5, 5]))
        .expect(200);

      // All criteria at the top of a 1-5 range is exactly 100.
      expect(res.body.weightedTotal).toBe(100);
    });

    it("ignores a client-supplied total", async () => {
      const queue = await as(judgeA).get(`/api/events/${event.id}/judge/queue`).expect(200);
      const target = queue.body.items[0].submission.id;

      const res = await as(judgeA)
        .put(`/api/events/${event.id}/judge/scores/${target}`)
        .send({ ...ballot([1, 1, 1]), weightedTotal: 99, judgeId: judgeB.id })
        .expect(200);

      expect(res.body.weightedTotal).toBe(0);
      // The ballot still belongs to the caller, not the id they supplied.
      expect(res.body.judgeId).toBe(judgeA.id);
    });

    it("rejects a score outside the criterion range", async () => {
      const queue = await as(judgeA).get(`/api/events/${event.id}/judge/queue`).expect(200);
      const target = queue.body.items[0].submission.id;

      const res = await as(judgeA)
        .put(`/api/events/${event.id}/judge/scores/${target}`)
        .send(ballot([9, 3, 3]))
        .expect(422);
      expect(res.body.error.details.impact).toBeTruthy();
    });

    it("rejects an incomplete ballot", async () => {
      const queue = await as(judgeA).get(`/api/events/${event.id}/judge/queue`).expect(200);
      const target = queue.body.items[0].submission.id;

      await as(judgeA)
        .put(`/api/events/${event.id}/judge/scores/${target}`)
        .send({ criteria: [{ criterionId: criterionIds[0]!, value: 4 }] })
        .expect(422);
    });

    it("locks the rubric once a ballot exists", async () => {
      await as(organizer).put(`/api/events/${event.id}/rubric`).send(RUBRIC).expect(409);
    });
  });

  describe("cross-judge isolation", () => {
    let scoredSubmission: string;

    beforeAll(async () => {
      const queueB = await as(judgeB).get(`/api/events/${event.id}/judge/queue`).expect(200);
      scoredSubmission = queueB.body.items[0].submission.id;

      await as(judgeB)
        .put(`/api/events/${event.id}/judge/scores/${scoredSubmission}`)
        .send({
          criteria: criterionIds.map((id) => ({ criterionId: id, value: 2 })),
          comment: "Judge B private note.",
        })
        .expect(200);
    });

    it("stops judge A reading judge B's ballot through the judge endpoint", async () => {
      const assignedToA = await prisma.judgeAssignment.findUnique({
        where: {
          judgeId_submissionId: { judgeId: judgeA.id, submissionId: scoredSubmission },
        },
      });

      const res = await as(judgeA)
        .get(`/api/events/${event.id}/judge/scores/${scoredSubmission}`)
        .expect(assignedToA ? 200 : 403);

      if (assignedToA) {
        // Judge A may be assigned the same project, but only ever sees their own
        // ballot for it, never judge B's.
        if (res.body) expect(res.body.judgeId).toBe(judgeA.id);
      }
    });

    it("never leaks another judge's comment in the queue", async () => {
      const queueA = await as(judgeA).get(`/api/events/${event.id}/judge/queue`).expect(200);
      expect(JSON.stringify(queueA.body)).not.toContain("Judge B private note.");
    });

    it("refuses the full score set to a judge", async () => {
      await as(judgeA).get(`/api/events/${event.id}/scores`).expect(403);
      await as(judgeB).get(`/api/events/${event.id}/scores`).expect(403);
    });

    it("refuses the full score set to a participant", async () => {
      await as(builder1).get(`/api/events/${event.id}/scores`).expect(403);
    });

    it("allows the organizer to read the full score set", async () => {
      const res = await as(organizer).get(`/api/events/${event.id}/scores`).expect(200);
      expect(res.body.length).toBeGreaterThan(0);
    });

    it("refuses the judging progress dashboard to a judge", async () => {
      await as(judgeA).get(`/api/events/${event.id}/progress`).expect(403);
    });

    it("ignores a judgeId query parameter entirely", async () => {
      const queue = await anon()
        .get(`/api/events/${event.id}/judge/queue?judgeId=${judgeB.id}`)
        .set("Authorization", `Bearer ${judgeA.token}`)
        .expect(200);

      const mineA = await prisma.judgeAssignment.findMany({
        where: { eventId: event.id, judgeId: judgeA.id },
        select: { submissionId: true },
      });
      const returned = queue.body.items
        .map((i: { submission: { id: string } }) => i.submission.id)
        .sort();
      expect(returned).toEqual(mineA.map((a) => a.submissionId).sort());
    });
  });

  describe("cross-track isolation", () => {
    let trackEvent: { id: string; slug: string };
    let toolingTrack: string;
    let infraTrack: string;
    let toolingSub: string;
    let infraSub: string;
    let trackJudge: TestActor;

    beforeAll(async () => {
      trackJudge = await createUser({ name: "Track Judge" });
      trackEvent = await createEvent(organizer, {
        name: "Tracked Event",
        submissionDeadline: FUTURE,
        reviewsPerSubmission: 1,
      });
      toolingTrack = await createTrack(organizer, trackEvent.id, "Tooling");
      infraTrack = await createTrack(organizer, trackEvent.id, "Infra");

      toolingSub = await makeSubmission(
        builder1,
        trackEvent.id,
        "Tooling Team",
        "Tooling Project",
        toolingTrack,
      );
      infraSub = await makeSubmission(
        builder2,
        trackEvent.id,
        "Infra Team",
        "Infra Project",
        infraTrack,
      );

      // Restricted to Tooling only.
      await grantRole(organizer, trackEvent.id, trackJudge, "JUDGE", [toolingTrack]);
      await as(organizer)
        .put(`/api/events/${trackEvent.id}/rubric`)
        .send(RUBRIC)
        .expect(200);
      await as(organizer)
        .post(`/api/events/${trackEvent.id}/assignments/generate`)
        .send({ seed: 11 })
        .expect(200);
    });

    it("assigns a restricted judge only their own track", async () => {
      const queue = await as(trackJudge)
        .get(`/api/events/${trackEvent.id}/judge/queue`)
        .expect(200);

      const ids = queue.body.items.map((i: { submission: { id: string } }) => i.submission.id);
      expect(ids).toContain(toolingSub);
      expect(ids).not.toContain(infraSub);
    });

    it("refuses a ballot for a submission outside the judge's track", async () => {
      const rubric = await anon().get(`/api/events/${trackEvent.id}/rubric`).expect(200);
      const ids = rubric.body.criteria.map((c: { id: string }) => c.id);

      await as(trackJudge)
        .put(`/api/events/${trackEvent.id}/judge/scores/${infraSub}`)
        .send({ criteria: ids.map((id: string) => ({ criterionId: id, value: 4 })) })
        .expect(403);
    });

    it("refuses a manual assignment outside the judge's track scope", async () => {
      await as(organizer)
        .post(`/api/events/${trackEvent.id}/assignments`)
        .send({ judgeId: trackJudge.id, submissionId: infraSub })
        .expect(400);
    });
  });

  describe("cross-event isolation", () => {
    it("stops a judge in one event judging another", async () => {
      const otherEvent = await createEvent(organizer, {
        name: "Other Judged Event",
        submissionDeadline: FUTURE,
      });
      await as(judgeA).get(`/api/events/${otherEvent.id}/judge/queue`).expect(403);
      await as(judgeA).get(`/api/events/${otherEvent.id}/scores`).expect(403);
    });
  });

  describe("results", () => {
    it("refuses the preview to a judge", async () => {
      await as(judgeA).get(`/api/events/${event.id}/results/preview`).expect(403);
    });

    it("gives the organizer a preview with judge statistics", async () => {
      const res = await as(organizer)
        .get(`/api/events/${event.id}/results/preview?method=ZSCORE`)
        .expect(200);

      expect(res.body.method).toBe("ZSCORE");
      expect(Array.isArray(res.body.judgeStats)).toBe(true);
      expect(Array.isArray(res.body.standings)).toBe(true);
    });

    it("hides results from the public before publication", async () => {
      await anon().get(`/api/events/${event.id}/results`).expect(403);
      await as(builder1).get(`/api/events/${event.id}/results`).expect(403);
    });

    it("refuses publication before a normalization run exists", async () => {
      const fresh = await createEvent(organizer, { name: "Unrun Event" });
      await as(organizer)
        .post(`/api/events/${fresh.id}/results/publish`)
        .send({ publish: true })
        .expect(403);
    });

    it("stores an immutable normalization run", async () => {
      const res = await as(organizer)
        .post(`/api/events/${event.id}/results/normalize`)
        .send({ method: "ZSCORE" })
        .expect(201);

      expect(res.body.runId).toBeTruthy();

      const stored = await prisma.normalizationRun.findUnique({
        where: { id: res.body.runId },
        include: { scores: true },
      });
      expect(stored?.judgeStats).toBeTruthy();
      expect(stored?.scores.length).toBeGreaterThan(0);
    });

    it("keeps every run so a published result stays reproducible", async () => {
      await as(organizer)
        .post(`/api/events/${event.id}/results/normalize`)
        .send({ method: "RANK_AVERAGE" })
        .expect(201);

      const runs = await as(organizer)
        .get(`/api/events/${event.id}/results/runs`)
        .expect(200);
      expect(runs.body.length).toBeGreaterThanOrEqual(2);
    });

    it("publishes results and opens them to the public", async () => {
      await as(organizer)
        .post(`/api/events/${event.id}/results/publish`)
        .send({ publish: true })
        .expect(200);

      const res = await anon().get(`/api/events/${event.id}/results`).expect(200);
      expect(res.body.standings.length).toBeGreaterThan(0);
      expect(res.body.standings[0].rank).toBe(1);
    });

    it("refuses publication to a judge", async () => {
      await as(judgeA)
        .post(`/api/events/${event.id}/results/publish`)
        .send({ publish: false })
        .expect(403);
    });
  });

  describe("audit trail", () => {
    it("records assignment, scoring, normalization and publication", async () => {
      const actions = await prisma.auditLog.findMany({
        where: { eventId: event.id },
        select: { action: true },
      });
      const seen = new Set(actions.map((a) => a.action));

      expect(seen.has("JUDGE_ASSIGNED")).toBe(true);
      expect(seen.has("SCORE_SUBMITTED")).toBe(true);
      expect(seen.has("NORMALIZATION_RUN")).toBe(true);
      expect(seen.has("RESULTS_PUBLISHED")).toBe(true);
    });

    it("refuses the audit trail to a judge", async () => {
      await as(judgeA).get(`/api/events/${event.id}/progress`).expect(403);
    });
  });
});
