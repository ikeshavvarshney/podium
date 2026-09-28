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

async function submitProject(actor: TestActor, eventId: string, teamName: string, projectName: string) {
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

describe("who may vote, by role", () => {
  let organizer: TestActor;
  let alice: TestActor;
  let bob: TestActor;
  let judge: TestActor;
  let admin: TestActor;
  let visitor: TestActor;
  let event: { id: string; slug: string };
  let projectA: string;
  let projectB: string;

  const vote = (actor: TestActor | null, submissionId: string, extra: Record<string, unknown> = {}) =>
    (actor ? as(actor) : anon())
      .post(`/api/events/${event.id}/votes`)
      .send({ entries: [{ submissionId, weight: 1 }], ...extra });
  const configure = (body: Record<string, unknown>) =>
    as(organizer).put(`/api/events/${event.id}/voting/config`).send(body);

  beforeAll(async () => {
    await resetDatabase();
    await rateLimitStore.reset();
    organizer = await createOrganizer("Organizer");
    alice = await createUser({ name: "Alice" });
    bob = await createUser({ name: "Bob" });
    judge = await createUser({ name: "Judge" });
    admin = await createUser({ name: "Admin" });
    visitor = await createUser({ name: "Visitor" });
    event = await createEvent(organizer, { name: "Role Vote", submissionDeadline: FUTURE });
    projectA = await submitProject(alice, event.id, "Team Alice", "Sievebox");
    projectB = await submitProject(bob, event.id, "Team Bob", "Driftwatch");
    await grantRole(organizer, event.id, judge, "JUDGE");
    await grantRole(organizer, event.id, admin, "ADMIN");
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("defaults to visitors and participants, not judges or admins", async () => {
    const res = await configure({ enabled: true, access: "AUTHENTICATED" }).expect(200);
    expect(res.body).toMatchObject({ allowVisitors: true, allowParticipants: true, allowJudges: false, allowAdmins: false });

    await vote(visitor, projectA).expect(201);
    await vote(alice, projectB).expect(201);
    await vote(judge, projectA).expect(403);
    await vote(admin, projectA).expect(403);
  });

  it("refuses participants when the organizer turns them off", async () => {
    await configure({ allowParticipants: false }).expect(200);
    const res = await vote(bob, projectA).expect(403);
    expect(res.body.error.message).toContain("Participants");
    await vote(visitor, projectB).expect(201);
  });

  it("refuses visitors, signed in or anonymous, when the organizer turns them off", async () => {
    await configure({ allowParticipants: true, allowVisitors: false, access: "EMAIL_GATED" }).expect(200);
    await vote(visitor, projectA).expect(403);
    await vote(null, projectA, { email: "someone@example.test" }).expect(403);
    await vote(bob, projectA).expect(201);
  });

  it("lets judges and admins vote only when allowed", async () => {
    await configure({ allowJudges: true, allowAdmins: true }).expect(200);
    await vote(judge, projectA).expect(201);
    await vote(admin, projectB).expect(201);
  });

  it("requires every role a person holds to be allowed", async () => {
    await grantRole(organizer, event.id, bob, "JUDGE");
    await configure({ allowJudges: false }).expect(200);
    const res = await vote(bob, projectA).expect(403);
    expect(res.body.error.message).toContain("Judges");
  });

  it("tells the ballot page up front why someone cannot vote", async () => {
    const res = await as(visitor).get(`/api/events/${event.id}/voting/ballot`).expect(200);
    expect(res.body.ineligibleReason).toBe("Only people taking part in this event may vote.");
    const ok = await as(alice).get(`/api/events/${event.id}/voting/ballot`).expect(200);
    expect(ok.body.ineligibleReason).toBeNull();
  });

  it("refuses a configuration that lets nobody vote", async () => {
    const res = await configure({ allowVisitors: false, allowParticipants: false, allowJudges: false, allowAdmins: false }).expect(400);
    expect(res.body.error.details.voters).toBe("Allow at least one group to vote.");
  });
});
