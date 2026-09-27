import { afterAll, beforeAll, describe, expect, it } from "vitest";
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

describe("event updates", () => {
  let organizer: TestActor;
  let judge: TestActor;
  let participant: TestActor;
  let event: { id: string; slug: string };
  let updateId: string;

  beforeAll(async () => {
    await resetDatabase();
    organizer = await createOrganizer("Organizer");
    judge = await createUser({ name: "Judge" });
    participant = await createUser({ name: "Participant" });
    event = await createEvent(organizer, { name: "Update Event" });
    await grantRole(organizer, event.id, judge, "JUDGE");
    await grantRole(organizer, event.id, participant, "PARTICIPANT");
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("lets an event admin post an update", async () => {
    const res = await as(organizer)
      .post(`/api/events/${event.id}/updates`)
      .send({ title: "Scoring closes Friday", body: "Ballots must be in by 23:59 UTC.", pinned: true })
      .expect(201);

    expect(res.body.title).toBe("Scoring closes Friday");
    expect(res.body.pinned).toBe(true);
    expect(res.body.author.name).toBe("Organizer");
    updateId = res.body.id;
  });

  it("records the post in the audit log", async () => {
    const entry = await prisma.auditLog.findFirst({
      where: { eventId: event.id, action: "EVENT_UPDATE_POSTED" },
    });
    expect(entry).not.toBeNull();
    expect(entry?.actorId).toBe(organizer.id);
  });

  it("shows updates to anyone who can see the event", async () => {
    const asJudge = await as(judge).get(`/api/events/${event.id}/updates`).expect(200);
    expect(asJudge.body).toHaveLength(1);

    const asPublic = await anon().get(`/api/events/${event.slug}/updates`).expect(200);
    expect(asPublic.body[0].title).toBe("Scoring closes Friday");
  });

  it("refuses posting, editing and deleting from a judge or participant", async () => {
    await as(judge)
      .post(`/api/events/${event.id}/updates`)
      .send({ title: "Not allowed", body: "Nope." })
      .expect(403);

    await as(participant)
      .patch(`/api/events/${event.id}/updates/${updateId}`)
      .send({ pinned: false })
      .expect(403);

    await as(judge).delete(`/api/events/${event.id}/updates/${updateId}`).expect(403);
  });

  it("refuses an update belonging to another event", async () => {
    const other = await createEvent(organizer, { name: "Other Event" });
    await as(organizer)
      .patch(`/api/events/${other.id}/updates/${updateId}`)
      .send({ pinned: false })
      .expect(404);
  });

  it("validates the body", async () => {
    await as(organizer).post(`/api/events/${event.id}/updates`).send({ title: "", body: "" }).expect(400);
  });

  it("tracks read state per account, never leaking another account's", async () => {
    const posted = await as(organizer)
      .post(`/api/events/${event.id}/updates`)
      .send({ title: "Pitch slots", body: "Booking opens tomorrow.", tag: "LOGISTICS" })
      .expect(201);
    expect(posted.body.tag).toBe("LOGISTICS");

    const before = await as(judge).get(`/api/events/${event.id}/updates`).expect(200);
    expect(before.body.every((u: { read: boolean }) => !u.read)).toBe(true);

    await as(judge).post(`/api/events/${event.id}/updates/${posted.body.id}/read`).expect(204);
    const judgeView = await as(judge).get(`/api/events/${event.id}/updates`).expect(200);
    expect(judgeView.body.find((u: { id: string }) => u.id === posted.body.id).read).toBe(true);

    const participantView = await as(participant).get(`/api/events/${event.id}/updates`).expect(200);
    expect(participantView.body.find((u: { id: string }) => u.id === posted.body.id).read).toBe(false);

    await as(participant).post(`/api/events/${event.id}/updates/read-all`).expect(204);
    const after = await as(participant).get(`/api/events/${event.id}/updates`).expect(200);
    expect(after.body.every((u: { read: boolean }) => u.read)).toBe(true);
  });

  it("deletes an update as an admin", async () => {
    await as(organizer).delete(`/api/events/${event.id}/updates/${updateId}`).expect(204);
    const after = await as(organizer).get(`/api/events/${event.id}/updates`).expect(200);
    expect(after.body.some((u: { id: string }) => u.id === updateId)).toBe(false);
  });
});
