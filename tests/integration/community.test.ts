import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  anon,
  as,
  createEvent,
  createOrganizer,
  createUser,
  prisma,
  resetDatabase,
  type TestActor,
} from "../helpers.js";

const FUTURE = new Date(Date.now() + 7 * 24 * 60 * 60_000).toISOString();

describe("speakers, mentors and partners", () => {
  let organizer: TestActor;
  let outsider: TestActor;
  let event: { id: string; slug: string };

  beforeAll(async () => {
    await resetDatabase();
    organizer = await createOrganizer("Organizer");
    outsider = await createUser({ name: "Outsider" });
    event = await createEvent(organizer, { name: "People Event" });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("refuses a non-admin adding a speaker", async () => {
    await as(outsider)
      .post(`/api/events/${event.id}/people`)
      .send({ kind: "SPEAKER", name: "Simone Falk", role: "Opening keynote", org: "Terrawatt" })
      .expect(403);
  });

  it("lets an admin add a speaker and a mentor", async () => {
    const speaker = await as(organizer)
      .post(`/api/events/${event.id}/people`)
      .send({ kind: "SPEAKER", name: "Simone Falk", role: "Opening keynote", org: "Terrawatt" })
      .expect(201);
    expect(speaker.body.kind).toBe("SPEAKER");

    await as(organizer)
      .post(`/api/events/${event.id}/people`)
      .send({ kind: "MENTOR", name: "Aurélie Deschamps", role: "Distributed systems", org: "Northsill" })
      .expect(201);
  });

  it("lists people publicly, in position order", async () => {
    const res = await anon().get(`/api/events/${event.id}/people`).expect(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0].name).toBe("Simone Falk");
  });

  it("lets an admin add and remove a partner", async () => {
    const partner = await as(organizer)
      .post(`/api/events/${event.id}/partners`)
      .send({ name: "Northgale", tier: "Platinum sponsor" })
      .expect(201);

    const listed = await anon().get(`/api/events/${event.id}/partners`).expect(200);
    expect(listed.body).toHaveLength(1);

    await as(organizer).delete(`/api/events/${event.id}/partners/${partner.body.id}`).expect(204);
    const after = await anon().get(`/api/events/${event.id}/partners`).expect(200);
    expect(after.body).toHaveLength(0);
  });
});

describe("sponsor challenges", () => {
  let organizer: TestActor;
  let alice: TestActor;
  let event: { id: string; slug: string };
  let challengeId: string;

  beforeAll(async () => {
    await resetDatabase();
    organizer = await createOrganizer("Organizer");
    alice = await createUser({ name: "Alice" });
    event = await createEvent(organizer, { name: "Challenge Event", submissionDeadline: FUTURE });

    const challenge = await as(organizer)
      .post(`/api/events/${event.id}/challenges`)
      .send({
        sponsor: "Verdanto",
        name: "Best use of embeddings",
        brief: "Ship something that puts a vector index to real use.",
        amountCents: 300000,
        tags: ["ml", "search"],
      })
      .expect(201);
    challengeId = challenge.body.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("starts with zero entries", async () => {
    const res = await anon().get(`/api/events/${event.id}/challenges`).expect(200);
    expect(res.body[0].entries).toBe(0);
  });

  it("rejects a challenge id from another event", async () => {
    await as(alice).post(`/api/events/${event.id}/register`).expect(201);
    await as(alice).post(`/api/events/${event.id}/teams`).send({ name: "Team Alice" }).expect(201);
    await as(alice)
      .post(`/api/events/${event.id}/submissions`)
      .send({ name: "Sievebox", challengeIds: ["00000000-0000-0000-0000-000000000000"] })
      .expect(400);
  });

  it("counts a submitted project that opted in", async () => {
    await as(alice)
      .post(`/api/events/${event.id}/submissions`)
      .send({ name: "Sievebox", tagline: "Spam filter you train by forwarding email." })
      .expect(201);
    await as(alice)
      .patch(`/api/events/${event.id}/submissions/mine`)
      .send({
        description: "A long enough description for judges to read comfortably.",
        challengeIds: [challengeId],
      })
      .expect(200);
    await as(alice).post(`/api/events/${event.id}/submissions/mine/submit`).expect(200);

    const res = await anon().get(`/api/events/${event.id}/challenges`).expect(200);
    expect(res.body[0].entries).toBe(1);
  });
});
