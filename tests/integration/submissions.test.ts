import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  anon,
  as,
  createEvent,
  createOrganizer,
  createTrack,
  createUser,
  prisma,
  resetDatabase,
  type TestActor,
} from "../helpers.js";

const PAST = new Date(Date.now() - 60_000).toISOString();
const FUTURE = new Date(Date.now() + 7 * 24 * 60 * 60_000).toISOString();

async function joinTeam(actor: TestActor, eventId: string, teamName: string) {
  await as(actor).post(`/api/events/${eventId}/register`).expect(201);
  const res = await as(actor)
    .post(`/api/events/${eventId}/teams`)
    .send({ name: teamName })
    .expect(201);
  return res.body.id as string;
}

describe("teams, invites and submissions", () => {
  let organizer: TestActor;
  let alice: TestActor;
  let bob: TestActor;
  let carol: TestActor;
  let event: { id: string; slug: string };
  let trackId: string;

  beforeAll(async () => {
    await resetDatabase();
    organizer = await createOrganizer("Organizer");
    alice = await createUser({ name: "Alice" });
    bob = await createUser({ name: "Bob" });
    carol = await createUser({ name: "Carol" });
    event = await createEvent(organizer, {
      name: "Build Weekend",
      submissionDeadline: FUTURE,
    });
    trackId = await createTrack(organizer, event.id, "Tooling");
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe("team formation", () => {
    it("refuses team creation before registering for the event", async () => {
      await as(alice)
        .post(`/api/events/${event.id}/teams`)
        .send({ name: "Too Early" })
        .expect(403);
    });

    it("creates a team and makes the creator its owner", async () => {
      await as(alice).post(`/api/events/${event.id}/register`).expect(201);
      const res = await as(alice)
        .post(`/api/events/${event.id}/teams`)
        .send({ name: "Sievebox" })
        .expect(201);

      expect(res.body.members).toHaveLength(1);
      expect(res.body.members[0].role).toBe("OWNER");
    });

    it("refuses a second team for the same person in one event", async () => {
      await as(alice)
        .post(`/api/events/${event.id}/teams`)
        .send({ name: "Second Team" })
        .expect(409);
    });
  });

  describe("invite links", () => {
    let teamId: string;
    let inviteToken: string;

    beforeAll(async () => {
      const mine = await as(alice).get(`/api/events/${event.id}/teams/mine`).expect(200);
      teamId = mine.body.id;
    });

    it("lets only the team owner mint an invite", async () => {
      await as(bob)
        .post(`/api/events/${event.id}/teams/${teamId}/invites`)
        .send({})
        .expect(403);

      const res = await as(alice)
        .post(`/api/events/${event.id}/teams/${teamId}/invites`)
        .send({ maxUses: 2 })
        .expect(201);

      expect(res.body.token).toBeTruthy();
      inviteToken = res.body.token;
    });

    it("stores only a hash of the token", async () => {
      const rows = await prisma.teamInvite.findMany({ where: { teamId } });
      expect(rows.every((r) => r.tokenHash !== inviteToken)).toBe(true);
      expect(rows[0]?.tokenHash).toHaveLength(64);
    });

    it("rejects an invalid token", async () => {
      await as(bob)
        .post("/api/invites/accept")
        .send({ token: "not-a-real-token-value" })
        .expect(404);
    });

    it("adds the joiner to the team and registers them for the event", async () => {
      const res = await as(bob)
        .post("/api/invites/accept")
        .send({ token: inviteToken })
        .expect(200);

      expect(res.body.members).toHaveLength(2);
      const membership = await prisma.eventMembership.findFirst({
        where: { eventId: event.id, userId: bob.id, role: "PARTICIPANT" },
      });
      expect(membership).not.toBeNull();
    });

    it("refuses to add the same person twice", async () => {
      await as(bob).post("/api/invites/accept").send({ token: inviteToken }).expect(409);
    });

    it("stops honouring a revoked invite", async () => {
      const created = await as(alice)
        .post(`/api/events/${event.id}/teams/${teamId}/invites`)
        .send({})
        .expect(201);

      await as(alice)
        .delete(`/api/events/${event.id}/teams/${teamId}/invites/${created.body.id}`)
        .expect(204);

      await as(carol)
        .post("/api/invites/accept")
        .send({ token: created.body.token })
        .expect(403);
    });

    it("never exposes the token when listing invites", async () => {
      const res = await as(alice)
        .get(`/api/events/${event.id}/teams/${teamId}/invites`)
        .expect(200);
      const serialized = JSON.stringify(res.body);
      expect(serialized).not.toContain(inviteToken);
      expect(serialized).not.toContain("tokenHash");
    });
  });

  describe("submission lifecycle", () => {
    it("requires a team before creating a submission", async () => {
      const loner = await createUser({ name: "Loner" });
      await as(loner).post(`/api/events/${event.id}/register`).expect(201);
      await as(loner)
        .post(`/api/events/${event.id}/submissions`)
        .send({ name: "No Team" })
        .expect(400);
    });

    it("creates a draft", async () => {
      const res = await as(alice)
        .post(`/api/events/${event.id}/submissions`)
        .send({ name: "Sievebox", tagline: "Spam filter you train by forwarding email." })
        .expect(201);
      expect(res.body.status).toBe("DRAFT");
    });

    it("refuses a second submission for one team", async () => {
      await as(bob)
        .post(`/api/events/${event.id}/submissions`)
        .send({ name: "Duplicate" })
        .expect(409);
    });

    it("keeps drafts out of the public gallery", async () => {
      const res = await anon().get(`/api/events/${event.id}/submissions`).expect(200);
      expect(res.body.items).toHaveLength(0);
    });

    it("refuses to submit an incomplete entry", async () => {
      const res = await as(alice)
        .post(`/api/events/${event.id}/submissions/mine/submit`)
        .expect(400);
      expect(res.body.error.details.description).toBeTruthy();
    });

    it("lets any team member edit the draft", async () => {
      await as(bob)
        .patch(`/api/events/${event.id}/submissions/mine`)
        .send({
          description: "A long enough description of the project for the judges to read.",
          trackId,
          techTags: ["imap", "embeddings"],
        })
        .expect(200);
    });

    it("rejects a track from another event", async () => {
      const other = await createEvent(organizer, { name: "Other Event" });
      const foreignTrack = await createTrack(organizer, other.id, "Foreign");
      await as(alice)
        .patch(`/api/events/${event.id}/submissions/mine`)
        .send({ trackId: foreignTrack })
        .expect(400);
    });

    it("rejects a malformed repository URL", async () => {
      await as(alice)
        .patch(`/api/events/${event.id}/submissions/mine`)
        .send({ repoUrl: "github.com/no-scheme" })
        .expect(400);
    });

    it("submits a complete entry and publishes it to the gallery", async () => {
      const res = await as(alice)
        .post(`/api/events/${event.id}/submissions/mine/submit`)
        .expect(200);
      expect(res.body.status).toBe("SUBMITTED");

      const gallery = await anon().get(`/api/events/${event.id}/submissions`).expect(200);
      expect(gallery.body.items).toHaveLength(1);
      expect(gallery.body.items[0].name).toBe("Sievebox");
    });

    it("refuses edits from someone outside the team", async () => {
      await as(carol).post(`/api/events/${event.id}/register`).expect(201);
      await as(carol)
        .patch(`/api/events/${event.id}/submissions/mine`)
        .send({ name: "Stolen" })
        .expect(404);
    });
  });

  describe("gallery search and filter", () => {
    it("matches on name", async () => {
      const res = await anon()
        .get(`/api/events/${event.id}/submissions?q=sievebox`)
        .expect(200);
      expect(res.body.items).toHaveLength(1);
    });

    it("returns nothing for a non-matching query", async () => {
      const res = await anon()
        .get(`/api/events/${event.id}/submissions?q=nonexistent-xyz`)
        .expect(200);
      expect(res.body.items).toHaveLength(0);
    });

    it("filters by track", async () => {
      const hit = await anon()
        .get(`/api/events/${event.id}/submissions?track=tooling`)
        .expect(200);
      expect(hit.body.items).toHaveLength(1);

      const miss = await anon()
        .get(`/api/events/${event.id}/submissions?track=nothing`)
        .expect(200);
      expect(miss.body.items).toHaveLength(0);
    });

    it("filters by tech tag", async () => {
      const res = await anon()
        .get(`/api/events/${event.id}/submissions?tag=imap`)
        .expect(200);
      expect(res.body.items).toHaveLength(1);
    });

    it("reports facets", async () => {
      const res = await anon().get(`/api/events/${event.id}/submissions/facets`).expect(200);
      expect(res.body.total).toBe(1);
      expect(res.body.tags.map((t: { tag: string }) => t.tag)).toContain("imap");
    });
  });

  describe("server-side deadline enforcement", () => {
    let closedEvent: { id: string; slug: string };
    let dave: TestActor;

    beforeAll(async () => {
      dave = await createUser({ name: "Dave" });
      closedEvent = await createEvent(organizer, { name: "Closed Event" });
      await as(dave).post(`/api/events/${closedEvent.id}/register`).expect(201);
      await as(dave)
        .post(`/api/events/${closedEvent.id}/teams`)
        .send({ name: "Late Team" })
        .expect(201);
      await as(dave)
        .post(`/api/events/${closedEvent.id}/submissions`)
        .send({ name: "Late Project", tagline: "Made it just in time." })
        .expect(201);

      // Move the deadline into the past, exactly as an organizer clock would.
      await as(organizer)
        .patch(`/api/events/${closedEvent.id}`)
        .send({ submissionDeadline: PAST })
        .expect(200);
    });

    it("reports the window as closed", async () => {
      const res = await anon()
        .get(`/api/events/${closedEvent.id}/submissions/window`)
        .expect(200);
      expect(res.body.open).toBe(false);
    });

    it("rejects edits after the deadline", async () => {
      const res = await as(dave)
        .patch(`/api/events/${closedEvent.id}/submissions/mine`)
        .send({ name: "Sneaky Late Edit" })
        .expect(403);
      expect(res.body.error.message).toMatch(/deadline/i);
    });

    it("rejects submitting after the deadline", async () => {
      await as(dave)
        .post(`/api/events/${closedEvent.id}/submissions/mine/submit`)
        .expect(403);
    });

    it("rejects creating a new submission after the deadline", async () => {
      const eve = await createUser({ name: "Eve" });
      await as(eve).post(`/api/events/${closedEvent.id}/register`).expect(201);
      await as(eve)
        .post(`/api/events/${closedEvent.id}/teams`)
        .send({ name: "Very Late Team" })
        .expect(201);
      await as(eve)
        .post(`/api/events/${closedEvent.id}/submissions`)
        .send({ name: "Way Too Late" })
        .expect(403);
    });

    it("leaves the stored record untouched by the rejected edit", async () => {
      const row = await prisma.submission.findFirst({
        where: { eventId: closedEvent.id },
        select: { name: true },
      });
      expect(row?.name).toBe("Late Project");
    });

    it("records the rejected edit in the audit log", async () => {
      const entries = await prisma.auditLog.findMany({
        where: { eventId: closedEvent.id, action: "SUBMISSION_EDIT_REJECTED" },
      });
      expect(entries.length).toBeGreaterThan(0);
    });
  });

  describe("organizer lock override", () => {
    it("blocks edits once an entry is locked, even before the deadline", async () => {
      const all = await as(organizer)
        .get(`/api/events/${event.id}/submissions/all`)
        .expect(200);
      const target = all.body[0];

      await as(organizer)
        .post(`/api/events/${event.id}/submissions/${target.id}/lock`)
        .send({ locked: true })
        .expect(200);

      await as(alice)
        .patch(`/api/events/${event.id}/submissions/mine`)
        .send({ name: "Locked Out" })
        .expect(403);

      await as(organizer)
        .post(`/api/events/${event.id}/submissions/${target.id}/lock`)
        .send({ locked: false })
        .expect(200);

      await as(alice)
        .patch(`/api/events/${event.id}/submissions/mine`)
        .send({ name: "Sievebox" })
        .expect(200);
    });

    it("refuses the lock endpoint to a participant", async () => {
      const all = await as(organizer)
        .get(`/api/events/${event.id}/submissions/all`)
        .expect(200);
      await as(alice)
        .post(`/api/events/${event.id}/submissions/${all.body[0].id}/lock`)
        .send({ locked: true })
        .expect(403);
    });

    it("refuses the full submission list to a participant", async () => {
      await as(alice).get(`/api/events/${event.id}/submissions/all`).expect(403);
    });
  });
});
