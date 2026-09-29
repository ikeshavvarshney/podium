import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, createEvent, createOrganizer, createUser, prisma, resetDatabase, type TestActor } from "../helpers.js";

const FUTURE = new Date(Date.now() + 7 * 24 * 60 * 60_000).toISOString();

describe("voting method defaults and locking", () => {
  let organizer: TestActor;
  let alice: TestActor;
  let voter: TestActor;
  let event: { id: string; slug: string };
  let project: string;
  const config = () => as(organizer).put(`/api/events/${event.id}/voting/config`);

  beforeAll(async () => {
    await resetDatabase();
    organizer = await createOrganizer("Organizer");
    alice = await createUser({ name: "Alice" });
    voter = await createUser({ name: "Voter" });
    event = await createEvent(organizer, { name: "Lock Event", submissionDeadline: FUTURE });
    await as(alice).post(`/api/events/${event.id}/register`).expect(201);
    await as(alice).post(`/api/events/${event.id}/teams`).send({ name: "Team Alice" }).expect(201);
    const draft = await as(alice).post(`/api/events/${event.id}/submissions`).send({ name: "Sievebox", tagline: "A tagline." }).expect(201);
    await as(alice)
      .patch(`/api/events/${event.id}/submissions/mine`)
      .send({ description: "A long enough description of the project for the judges to read." })
      .expect(200);
    await as(alice).post(`/api/events/${event.id}/submissions/mine/submit`).expect(200);
    project = draft.body.id as string;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("defaults to one vote per person", async () => {
    const res = await as(organizer).get(`/api/events/${event.id}/voting/config`).expect(200);
    expect(res.body.method).toBe("SINGLE");
    expect(res.body.maxChoices).toBe(1);
    expect(res.body.allowVoteChange).toBe(true);
    expect(res.body.methodLocked).toBe(false);
  });

  it("makes the organizer set a credit budget when choosing quadratic", async () => {
    const res = await config().send({ method: "QUADRATIC" }).expect(400);
    expect(res.body.error.details.creditBudget).toBeTruthy();
    const ok = await config().send({ method: "QUADRATIC", creditBudget: 30 }).expect(200);
    expect(ok.body.method).toBe("QUADRATIC");
    expect(ok.body.creditBudget).toBe(30);
  });

  it("locks the method and budget while the poll is live, but not other settings", async () => {
    await config().send({ enabled: true }).expect(200);
    const state = await as(organizer).get(`/api/events/${event.id}/voting/config`).expect(200);
    expect(state.body.methodLocked).toBe(true);
    await config().send({ method: "SINGLE" }).expect(409);
    await config().send({ creditBudget: 50 }).expect(409);
    await config().send({ hideResults: false }).expect(200);
  });

  it("stays locked after the poll closes once a ballot exists", async () => {
    await as(voter)
      .post(`/api/events/${event.id}/votes`)
      .send({ entries: [{ submissionId: project, weight: 2 }] })
      .expect(201);
    await config().send({ enabled: false }).expect(200);
    await config().send({ method: "SINGLE" }).expect(409);
  });
});
