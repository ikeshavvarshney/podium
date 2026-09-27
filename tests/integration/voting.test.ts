import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { rateLimitStore } from "../../src/server/src/middleware/rate-limit.js";
import {
  anon,
  as,
  createEvent,
  createOrganizer,
  createUser,
  grantRole,
  prisma,
  resetDatabase,
  type TestActor,
} from "../helpers.js";

const FUTURE = new Date(Date.now() + 7 * 24 * 60 * 60_000).toISOString();
const PAST = new Date(Date.now() - 60_000).toISOString();

async function submitProject(
  actor: TestActor,
  eventId: string,
  teamName: string,
  projectName: string,
): Promise<string> {
  await as(actor).post(`/api/events/${eventId}/register`).expect(201);
  await as(actor).post(`/api/events/${eventId}/teams`).send({ name: teamName }).expect(201);
  const draft = await as(actor)
    .post(`/api/events/${eventId}/submissions`)
    .send({ name: projectName, tagline: "A tagline." })
    .expect(201);
  await as(actor)
    .patch(`/api/events/${eventId}/submissions/mine`)
    .send({ description: "A long enough description of the project for the judges to read." })
    .expect(200);
  await as(actor).post(`/api/events/${eventId}/submissions/mine/submit`).expect(200);
  return draft.body.id as string;
}

describe("community voting", () => {
  let organizer: TestActor;
  let alice: TestActor;
  let bob: TestActor;
  let voter: TestActor;
  let judge: TestActor;
  let event: { id: string; slug: string };
  let projectA: string;
  let projectB: string;

  beforeAll(async () => {
    await resetDatabase();
    rateLimitStore.reset();

    organizer = await createOrganizer("Organizer");
    alice = await createUser({ name: "Alice" });
    bob = await createUser({ name: "Bob" });
    voter = await createUser({ name: "Voter" });
    judge = await createUser({ name: "Judge" });

    event = await createEvent(organizer, { name: "Voting Event", submissionDeadline: FUTURE });
    projectA = await submitProject(alice, event.id, "Team Alice", "Sievebox");
    projectB = await submitProject(bob, event.id, "Team Bob", "Driftwatch");
    await as(voter).post(`/api/events/${event.id}/register`).expect(201);
    await grantRole(organizer, event.id, judge, "JUDGE");
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("refuses ballots while voting is disabled", async () => {
    await as(voter)
      .post(`/api/events/${event.id}/votes`)
      .send({ entries: [{ submissionId: projectA, weight: 1 }] })
      .expect(403);
  });

  it("refuses voting configuration from a non-admin", async () => {
    await as(judge).put(`/api/events/${event.id}/voting/config`).send({ enabled: true }).expect(403);
    await as(voter).get(`/api/events/${event.id}/voting/config`).expect(403);
  });

  it("enables voting as an admin", async () => {
    const res = await as(organizer)
      .put(`/api/events/${event.id}/voting/config`)
      .send({ enabled: true, method: "QUADRATIC", creditBudget: 20, access: "AUTHENTICATED" })
      .expect(200);
    expect(res.body.enabled).toBe(true);
    expect(res.body.creditBudget).toBe(20);
  });

  it("requires a session when access is AUTHENTICATED", async () => {
    await anon()
      .post(`/api/events/${event.id}/votes`)
      .send({ entries: [{ submissionId: projectA, weight: 1 }] })
      .expect(403);
  });

  it("accepts a quadratic ballot and charges weight squared", async () => {
    const res = await as(voter)
      .post(`/api/events/${event.id}/votes`)
      .send({
        entries: [
          { submissionId: projectA, weight: 3 },
          { submissionId: projectB, weight: 2 },
        ],
      })
      .expect(201);

    expect(res.body.creditsSpent).toBe(13);
    expect(res.body.creditsRemaining).toBe(7);
  });

  it("replaces the previous ballot rather than stacking a second one", async () => {
    await as(voter)
      .post(`/api/events/${event.id}/votes`)
      .send({ entries: [{ submissionId: projectA, weight: 1 }] })
      .expect(201);

    const rows = await prisma.vote.findMany({
      where: { eventId: event.id, voterKey: `user:${voter.id}` },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.weight).toBe(1);
  });

  it("refuses a ballot that overruns the credit budget", async () => {
    await as(voter)
      .post(`/api/events/${event.id}/votes`)
      .send({ entries: [{ submissionId: projectA, weight: 10 }] })
      .expect(400);
  });

  it("refuses a vote for the voter's own project", async () => {
    await as(alice)
      .post(`/api/events/${event.id}/votes`)
      .send({ entries: [{ submissionId: projectA, weight: 1 }] })
      .expect(403);
  });

  it("refuses a vote for a submission in another event", async () => {
    const other = await createEvent(organizer, { name: "Other Voting Event" });
    const foreign = await submitProject(
      await createUser({ name: "Outsider" }),
      other.id,
      "Outside Team",
      "Foreign Project",
    );

    await as(voter)
      .post(`/api/events/${event.id}/votes`)
      .send({ entries: [{ submissionId: foreign, weight: 1 }] })
      .expect(404);
  });

  it("keeps judges out of community voting unless the organizer allows it", async () => {
    await as(judge)
      .post(`/api/events/${event.id}/votes`)
      .send({ entries: [{ submissionId: projectA, weight: 1 }] })
      .expect(403);

    await as(organizer).put(`/api/events/${event.id}/voting/config`).send({ allowJudges: true }).expect(200);
    await as(judge)
      .post(`/api/events/${event.id}/votes`)
      .send({ entries: [{ submissionId: projectA, weight: 1 }] })
      .expect(201);
    await as(organizer).put(`/api/events/${event.id}/voting/config`).send({ allowJudges: false }).expect(200);
  });

  it("records rejected ballots in the audit log", async () => {
    const rejected = await prisma.auditLog.findMany({
      where: { eventId: event.id, action: "VOTE_REJECTED" },
    });
    expect(rejected.length).toBeGreaterThan(0);
  });

  it("hides tallies from the public while the window is open", async () => {
    await anon().get(`/api/events/${event.slug}/votes/results`).expect(403);

    const forAdmin = await as(organizer).get(`/api/events/${event.id}/votes/results`).expect(200);
    expect(forAdmin.body.standings).toHaveLength(2);
  });

  it("publishes tallies once the window closes", async () => {
    await as(organizer).patch(`/api/events/${event.id}`).send({ votingClosesAt: PAST }).expect(200);

    const res = await anon().get(`/api/events/${event.slug}/votes/results`).expect(200);
    expect(res.body.standings[0].weight).toBeGreaterThan(0);

    await as(voter)
      .post(`/api/events/${event.id}/votes`)
      .send({ entries: [{ submissionId: projectB, weight: 1 }] })
      .expect(403);
  });

  it("identifies an email-gated voter by their address, not by a client-supplied id", async () => {
    const gated = await createEvent(organizer, { name: "Gated Voting", submissionDeadline: FUTURE });
    const project = await submitProject(
      await createUser({ name: "Gated Builder" }),
      gated.id,
      "Gated Team",
      "Gated Project",
    );
    await as(organizer)
      .put(`/api/events/${gated.id}/voting/config`)
      .send({ enabled: true, access: "EMAIL_GATED", method: "SINGLE" })
      .expect(200);

    await anon()
      .post(`/api/events/${gated.id}/votes`)
      .send({ entries: [{ submissionId: project, weight: 1 }] })
      .expect(400);

    await anon()
      .post(`/api/events/${gated.id}/votes`)
      .send({ email: "Someone@Example.test", entries: [{ submissionId: project, weight: 1 }] })
      .expect(201);

    await anon()
      .post(`/api/events/${gated.id}/votes`)
      .send({ email: "someone@example.test", entries: [{ submissionId: project, weight: 1 }] })
      .expect(201);

    const rows = await prisma.vote.findMany({ where: { eventId: gated.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.voterKey).toBe("email:someone@example.test");
  });
});
