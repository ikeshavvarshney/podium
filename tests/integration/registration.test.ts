import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  as,
  createEvent,
  createOrganizer,
  createUser,
  prisma,
  resetDatabase,
  type TestActor,
} from "../helpers.js";

const FUTURE = new Date(Date.now() + 7 * 24 * 60 * 60_000).toISOString();

describe("registration details", () => {
  let organizer: TestActor;
  let event: { id: string; slug: string };
  let questionId: string;

  beforeAll(async () => {
    await resetDatabase();
    organizer = await createOrganizer("Organizer");
    event = await createEvent(organizer, { name: "Clinic", registrationClosesAt: FUTURE, submissionDeadline: FUTURE });
    const q = await as(organizer)
      .post(`/api/events/${event.id}/questions`)
      .send({ prompt: "Which workflow are you targeting?", required: true, stage: "REGISTRATION" })
      .expect(201);
    questionId = q.body.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("refuses registration without the required organizer question", async () => {
    const alice = await createUser({ name: "Alice" });
    await as(alice)
      .post(`/api/events/${event.id}/register`)
      .send({ acceptRules: true, acceptConduct: true })
      .expect(400);
  });

  it("refuses registration without both agreements", async () => {
    const bob = await createUser({ name: "Bob" });
    await as(bob)
      .post(`/api/events/${event.id}/register`)
      .send({ acceptRules: true, answers: [{ questionId, value: "Discharge summaries" }] })
      .expect(400);
  });

  it("stores the details alongside the membership", async () => {
    const carol = await createUser({ name: "Carol" });
    await as(carol)
      .post(`/api/events/${event.id}/register`)
      .send({
        currentRole: "Engineer",
        experience: "A_FEW",
        skills: ["Backend", "Data"],
        shareProfile: true,
        acceptRules: true,
        acceptConduct: true,
        answers: [{ questionId, value: "Discharge summaries" }],
      })
      .expect(201);

    const saved = await prisma.registration.findFirstOrThrow({ where: { userId: carol.id } });
    expect(saved.experience).toBe("A_FEW");
    expect(saved.skills).toEqual(["Backend", "Data"]);
    expect((saved.answers as Record<string, string>)[questionId]).toBe("Discharge summaries");
  });

  it("does not let registration questions satisfy or block a submission", async () => {
    const required = await prisma.customQuestion.count({
      where: { eventId: event.id, required: true, stage: "SUBMISSION" },
    });
    expect(required).toBe(0);
  });

  it("counts participants and submitted projects only in the public numbers", async () => {
    const judge = await createUser({ name: "Judge" });
    await as(organizer).post(`/api/events/${event.id}/members`).send({ email: judge.email, role: "JUDGE" }).expect(201);

    const dana = await createUser({ name: "Dana" });
    await as(dana)
      .post(`/api/events/${event.id}/register`)
      .send({ acceptRules: true, acceptConduct: true, answers: [{ questionId, value: "Triage" }] })
      .expect(201);
    await as(dana).post(`/api/events/${event.id}/teams`).send({ name: "Draftless" }).expect(201);
    await as(dana).post(`/api/events/${event.id}/submissions`).send({ name: "Still a draft" }).expect(201);

    const participants = await prisma.eventMembership.count({ where: { eventId: event.id, role: "PARTICIPANT" } });
    const detail = await as(dana).get(`/api/events/${event.id}`).expect(200);
    expect(detail.body._count.memberships).toBe(participants);
    expect(detail.body._count.submissions).toBe(0);

    const listing = await as(dana).get("/api/events?take=50").expect(200);
    const card = listing.body.items.find((e: { id: string }) => e.id === event.id);
    expect(card._count.memberships).toBe(participants);
    expect(card._count.submissions).toBe(0);
  });
});
