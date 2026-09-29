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

const FUTURE = new Date(Date.now() + 7 * 24 * 60 * 60_000).toISOString();

describe("flagging a project out of public view", () => {
  let organizer: TestActor;
  let builder: TestActor;
  let judge: TestActor;
  let event: { id: string; slug: string };
  let submissionId: string;

  beforeAll(async () => {
    await resetDatabase();
    organizer = await createOrganizer("Organizer");
    builder = await createUser({ name: "Builder" });
    judge = await createUser({ name: "Judge" });
    event = await createEvent(organizer, { name: "Flag Weekend", submissionDeadline: FUTURE });

    await as(builder).post(`/api/events/${event.id}/register`).expect(201);
    await as(builder).post(`/api/events/${event.id}/teams`).send({ name: "Copycats" }).expect(201);
    const created = await as(builder)
      .post(`/api/events/${event.id}/submissions`)
      .send({
        name: "Copycat",
        tagline: "Suspiciously familiar.",
        description: "A project description that is comfortably longer than forty characters.",
      })
      .expect(201);
    submissionId = created.body.id;
    await as(builder).post(`/api/events/${event.id}/submissions/mine/submit`).expect(200);

    await grantRole(organizer, event.id, judge, "JUDGE");
    await as(organizer)
      .post(`/api/events/${event.id}/assignments`)
      .send({ judgeId: judge.id, submissionId })
      .expect(201);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("refuses a flag without a reason", async () => {
    await as(organizer)
      .post(`/api/events/${event.id}/submissions/${submissionId}/flag`)
      .send({ reason: "" })
      .expect(400);
  });

  it("refuses the flag endpoint to a participant", async () => {
    await as(builder)
      .post(`/api/events/${event.id}/submissions/${submissionId}/flag`)
      .send({ reason: "Flagging myself" })
      .expect(403);
  });

  it("hides the project from the gallery and the judge queue but keeps the row", async () => {
    await as(organizer)
      .post(`/api/events/${event.id}/submissions/${submissionId}/flag`)
      .send({ reason: "Built before the event window" })
      .expect(200);

    const gallery = await anon().get(`/api/events/${event.id}/submissions`).expect(200);
    expect(gallery.body.items).toHaveLength(0);
    await anon().get(`/api/events/${event.id}/submissions/${submissionId}`).expect(404);

    const queue = await as(judge).get(`/api/events/${event.id}/judge/queue`).expect(200);
    expect(queue.body.items).toHaveLength(0);

    const row = await prisma.submission.findUniqueOrThrow({ where: { id: submissionId } });
    expect(row.status).toBe("DISQUALIFIED");
    expect(row.flagReason).toBe("Built before the event window");

    const audit = await prisma.auditLog.findFirst({ where: { eventId: event.id, action: "SUBMISSION_FLAGGED" } });
    expect(audit?.summary).toContain("Built before the event window");
  });

  it("stops the team from editing or resubmitting its way back", async () => {
    await as(builder)
      .patch(`/api/events/${event.id}/submissions/mine`)
      .send({ name: "Renamed" })
      .expect(403);
    await as(builder).post(`/api/events/${event.id}/submissions/mine/submit`).expect(403);
  });

  it("restores the project to public view", async () => {
    await as(organizer).post(`/api/events/${event.id}/submissions/${submissionId}/restore`).expect(200);
    const gallery = await anon().get(`/api/events/${event.id}/submissions`).expect(200);
    expect(gallery.body.items).toHaveLength(1);
    const queue = await as(judge).get(`/api/events/${event.id}/judge/queue`).expect(200);
    expect(queue.body.items).toHaveLength(1);
  });
});
