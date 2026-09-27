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

describe("gallery comments", () => {
  let organizer: TestActor;
  let owner: TestActor;
  let userAccount: TestActor;
  let outsider: TestActor;
  let event: { id: string; slug: string };
  let submissionId: string;
  let commentId: string;

  beforeAll(async () => {
    await resetDatabase();
    organizer = await createOrganizer("Organizer");
    owner = await createUser({ name: "Owner" });
    userAccount = await createUser({ name: "Commenter" });
    outsider = await createUser({ name: "Outsider" });
    event = await createEvent(organizer, { name: "Comment Event", submissionDeadline: FUTURE });

    await as(owner).post(`/api/events/${event.id}/register`).expect(201);
    await as(owner).post(`/api/events/${event.id}/teams`).send({ name: "Team Owner" }).expect(201);
    const draft = await as(owner)
      .post(`/api/events/${event.id}/submissions`)
      .send({ name: "Sievebox", tagline: "Spam filter you train by forwarding email." })
      .expect(201);
    submissionId = draft.body.id;
    await as(owner)
      .patch(`/api/events/${event.id}/submissions/mine`)
      .send({ description: "A long enough description for judges to read comfortably." })
      .expect(200);
    await as(owner).post(`/api/events/${event.id}/submissions/mine/submit`).expect(200);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("refuses an unauthenticated comment", async () => {
    await anon()
      .post(`/api/events/${event.id}/submissions/${submissionId}/comments`)
      .send({ body: "Nice project" })
      .expect(401);
  });

  it("posts a comment on a submitted project", async () => {
    const res = await as(userAccount)
      .post(`/api/events/${event.id}/submissions/${submissionId}/comments`)
      .send({ body: "Love the spam filter idea." })
      .expect(201);
    expect(res.body.body).toBe("Love the spam filter idea.");
    expect(res.body.user.name).toBe("Commenter");
    commentId = res.body.id;
  });

  it("records the post in the audit log", async () => {
    const entry = await prisma.auditLog.findFirst({
      where: { eventId: event.id, action: "COMMENT_POSTED" },
    });
    expect(entry).not.toBeNull();
    expect(entry?.actorId).toBe(userAccount.id);
  });

  it("shows comments to anyone who can see the submission", async () => {
    const res = await anon()
      .get(`/api/events/${event.id}/submissions/${submissionId}/comments`)
      .expect(200);
    expect(res.body).toHaveLength(1);
  });

  it("refuses to remove someone else's comment", async () => {
    await as(outsider)
      .delete(`/api/events/${event.id}/submissions/${submissionId}/comments/${commentId}`)
      .expect(403);
  });

  it("lets an organizer hide a comment without deleting it", async () => {
    const res = await as(organizer)
      .post(`/api/events/${event.id}/submissions/${submissionId}/comments/${commentId}/hide`)
      .send({ reason: "Off topic" })
      .expect(200);
    expect(res.body.hiddenAt).not.toBeNull();

    const stillThere = await prisma.comment.findUnique({ where: { id: commentId } });
    expect(stillThere).not.toBeNull();
  });

  it("hides a hidden comment from the public but not from the organizer", async () => {
    const publicView = await anon()
      .get(`/api/events/${event.id}/submissions/${submissionId}/comments`)
      .expect(200);
    expect(publicView.body).toHaveLength(0);

    const organizerView = await as(organizer)
      .get(`/api/events/${event.id}/submissions/${submissionId}/comments`)
      .expect(200);
    expect(organizerView.body).toHaveLength(1);
    expect(organizerView.body[0].hiddenReason).toBe("Off topic");
  });

  it("refuses a non-organizer trying to hide a comment", async () => {
    await as(outsider)
      .post(`/api/events/${event.id}/submissions/${submissionId}/comments/${commentId}/hide`)
      .send({})
      .expect(403);
  });

  it("lets the author delete their own comment", async () => {
    await as(userAccount)
      .delete(`/api/events/${event.id}/submissions/${submissionId}/comments/${commentId}`)
      .expect(204);
    const gone = await prisma.comment.findUnique({ where: { id: commentId } });
    expect(gone).toBeNull();
  });

  it("refuses comments on a draft that has not been submitted", async () => {
    await as(owner).post(`/api/events/${event.id}/submissions/mine/withdraw`).expect(200);
    await as(userAccount)
      .post(`/api/events/${event.id}/submissions/${submissionId}/comments`)
      .send({ body: "Late comment" })
      .expect(404);
  });
});
