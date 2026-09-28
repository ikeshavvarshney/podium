import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
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
    await rateLimitStore.reset();

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

  describe("email-gated voting", () => {
    let gated: { id: string; slug: string };
    let project: string;

    /** The code goes to the API log when no SMTP server is configured. */
    async function requestCode(email: string): Promise<string> {
      const spy = vi.spyOn(console, "log").mockImplementation(() => undefined);
      try {
        const res = await anon().post(`/api/events/${gated.id}/voting/verify`).send({ email }).expect(202);
        expect(res.body.delivered).toBe("log");
        const line = spy.mock.calls.map((c) => String(c[0])).find((m) => m.includes(email.toLowerCase()));
        return /code is (\d{6})/.exec(line ?? "")![1]!;
      } finally {
        spy.mockRestore();
      }
    }

    beforeAll(async () => {
      gated = await createEvent(organizer, { name: "Gated Voting", submissionDeadline: FUTURE });
      project = await submitProject(await createUser({ name: "Gated Builder" }), gated.id, "Gated Team", "Gated Project");
      await as(organizer)
        .put(`/api/events/${gated.id}/voting/config`)
        .send({ enabled: true, access: "EMAIL_GATED", method: "SINGLE" })
        .expect(200);
    });

    it("refuses a ballot from an address nobody has proved", async () => {
      await anon().post(`/api/events/${gated.id}/votes`).send({ entries: [{ submissionId: project, weight: 1 }] }).expect(401);
      const ballot = await anon().get(`/api/events/${gated.id}/voting/ballot`).expect(200);
      expect(ballot.body.needsVerification).toBe(true);
    });

    it("counts a wrong code against the address and refuses it", async () => {
      const code = await requestCode("mallory@example.test");
      const wrong = code === "000000" ? "111111" : "000000";
      await anon().post(`/api/events/${gated.id}/voting/verify/confirm`).send({ email: "mallory@example.test", code: wrong }).expect(400);
      const row = await prisma.voterVerification.findFirstOrThrow({ where: { email: "mallory@example.test" } });
      expect(row.attempts).toBe(1);
    });

    it("identifies a verified voter by their address, and keeps one ballot per address", async () => {
      const code = await requestCode("Someone@Example.test");
      const confirmed = await anon()
        .post(`/api/events/${gated.id}/voting/verify/confirm`)
        .send({ email: "someone@example.test", code })
        .expect(200);
      const token = confirmed.body.token as string;

      for (let i = 0; i < 2; i++) {
        await anon()
          .post(`/api/events/${gated.id}/votes`)
          .set("x-voter-token", token)
          .send({ entries: [{ submissionId: project, weight: 1 }] })
          .expect(201);
      }
      const rows = await prisma.vote.findMany({ where: { eventId: gated.id } });
      expect(rows).toHaveLength(1);
      expect(rows[0]!.voterKey).toBe("email:someone@example.test");

      const ballot = await anon().get(`/api/events/${gated.id}/voting/ballot`).set("x-voter-token", token).expect(200);
      expect(ballot.body).toMatchObject({ needsVerification: false, verifiedEmail: "someone@example.test" });
      expect(ballot.body.myVotes).toHaveLength(1);
    });

    it("does not reveal how an address voted to someone who only knows the address", async () => {
      const ballot = await anon().get(`/api/events/${gated.id}/voting/ballot?email=someone@example.test`).expect(200);
      expect(ballot.body.myVotes).toEqual([]);
    });

    it("does not accept a voter token from another event", async () => {
      const code = await requestCode("elsewhere@example.test");
      const { body } = await anon()
        .post(`/api/events/${gated.id}/voting/verify/confirm`)
        .send({ email: "elsewhere@example.test", code })
        .expect(200);
      await anon()
        .post(`/api/events/${event.id}/votes`)
        .set("x-voter-token", body.token)
        .send({ entries: [{ submissionId: projectA, weight: 1 }] })
        .expect((res) => expect(res.status).not.toBe(201));
    });
  });

  describe("open-link voting", () => {
    let open: { id: string; slug: string };
    let projects: string[];
    const device = (id: string) => `podium_voter_device=${id}`;

    beforeAll(async () => {
      open = await createEvent(organizer, { name: "Open Voting", submissionDeadline: FUTURE });
      projects = [
        await submitProject(await createUser({ name: "Open A" }), open.id, "Open Team A", "Open Project A"),
        await submitProject(await createUser({ name: "Open B" }), open.id, "Open Team B", "Open Project B"),
      ];
      await as(organizer)
        .put(`/api/events/${open.id}/voting/config`)
        .send({ enabled: true, access: "OPEN_LINK", method: "SINGLE", maxVotesPerIpPerHour: 2 })
        .expect(200);
      await rateLimitStore.reset();
    });

    it("gives each browser on a shared address its own ballot", async () => {
      const first = await anon().get(`/api/events/${open.id}/voting/ballot`).expect(200);
      expect(String(first.headers["set-cookie"])).toContain("podium_voter_device=");

      await anon().post(`/api/events/${open.id}/votes`).set("Cookie", device("00000000-0000-4000-8000-000000000001")).send({ entries: [{ submissionId: projects[0], weight: 1 }] }).expect(201);
      await anon().post(`/api/events/${open.id}/votes`).set("Cookie", device("00000000-0000-4000-8000-000000000002")).send({ entries: [{ submissionId: projects[1], weight: 1 }] }).expect(201);
      const rows = await prisma.vote.findMany({ where: { eventId: open.id } });
      expect(new Set(rows.map((r) => r.voterKey)).size).toBe(2);
    });

    it("caps how many different voters one address can add in an hour", async () => {
      await anon().post(`/api/events/${open.id}/votes`).set("Cookie", device("00000000-0000-4000-8000-000000000003")).send({ entries: [{ submissionId: projects[0], weight: 1 }] }).expect(429);
      // A voter already counted may still change their ballot.
      await anon().post(`/api/events/${open.id}/votes`).set("Cookie", device("00000000-0000-4000-8000-000000000001")).send({ entries: [{ submissionId: projects[1], weight: 1 }] }).expect(201);
    });
  });

  describe("choice limit", () => {
    it("holds a voter to the organizer's limit on how many projects they back", async () => {
      const capped = await createEvent(organizer, { name: "Capped Voting", submissionDeadline: FUTURE });
      const a = await submitProject(await createUser({ name: "Cap A" }), capped.id, "Cap Team A", "Cap Project A");
      const b = await submitProject(await createUser({ name: "Cap B" }), capped.id, "Cap Team B", "Cap Project B");
      await as(organizer)
        .put(`/api/events/${capped.id}/voting/config`)
        .send({ enabled: true, access: "AUTHENTICATED", method: "SINGLE", maxChoices: 1 })
        .expect(200);
      const res = await as(voter)
        .post(`/api/events/${capped.id}/votes`)
        .send({ entries: [{ submissionId: a, weight: 1 }, { submissionId: b, weight: 1 }] })
        .expect(400);
      expect(res.body.error.message).toContain("one vote per person");
      await as(voter).post(`/api/events/${capped.id}/votes`).send({ entries: [{ submissionId: a, weight: 1 }] }).expect(201);
      await as(organizer).put(`/api/events/${capped.id}/voting/config`).send({ maxChoices: 2 }).expect(409);
    });
  });
});
