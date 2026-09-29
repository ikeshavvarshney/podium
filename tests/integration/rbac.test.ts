import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  anon,
  as,
  createEvent,
  createOrganizer,
  createTrack,
  createUser,
  grantRole,
  prisma,
  resetDatabase,
  type TestActor,
} from "../helpers.js";

describe("event-scoped RBAC", () => {
  let organizerA: TestActor;
  let organizerB: TestActor;
  let alice: TestActor;
  let bob: TestActor;
  let eventA: { id: string; slug: string };
  let eventB: { id: string; slug: string };

  beforeAll(async () => {
    await resetDatabase();
    organizerA = await createOrganizer("Organizer A");
    organizerB = await createOrganizer("Organizer B");
    alice = await createUser({ name: "Alice" });
    bob = await createUser({ name: "Bob" });
    eventA = await createEvent(organizerA, { name: "Event A" });
    eventB = await createEvent(organizerB, { name: "Event B" });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe("event fields round-trip", () => {
    it("persists mode and place on create and on update", async () => {
      const created = await as(organizerA)
        .post("/api/events")
        .send({ name: "Mode Event", mode: "IN_PERSON", place: "Copenhagen" })
        .expect(201);
      expect(created.body.mode).toBe("IN_PERSON");
      expect(created.body.place).toBe("Copenhagen");

      const updated = await as(organizerA)
        .patch(`/api/events/${created.body.id}`)
        .send({ mode: "ONLINE", place: null })
        .expect(200);
      expect(updated.body.mode).toBe("ONLINE");
      expect(updated.body.place).toBeNull();
    });
  });

  describe("event windows", () => {
    it("clears a window with null and keeps windows that were left out", async () => {
      const created = await as(organizerA)
        .post("/api/events")
        .send({
          name: "Window Event",
          judgingOpensAt: "2030-01-01T10:00:00.000Z",
          judgingClosesAt: "2030-01-02T10:00:00.000Z",
        })
        .expect(201);

      const cleared = await as(organizerA)
        .patch(`/api/events/${created.body.id}`)
        .send({ judgingOpensAt: null })
        .expect(200);
      expect(cleared.body.judgingOpensAt).toBeNull();
      expect(cleared.body.judgingClosesAt).toBe("2030-01-02T10:00:00.000Z");
    });

    it("refuses a window that closes before it opens", async () => {
      const created = await as(organizerA).post("/api/events").send({ name: "Backwards" }).expect(201);
      await as(organizerA)
        .patch(`/api/events/${created.body.id}`)
        .send({ votingOpensAt: "2030-01-02T10:00:00.000Z", votingClosesAt: "2030-01-01T10:00:00.000Z" })
        .expect(400);
    });
  });

  describe("roles are per event, not global", () => {
    it("gives one account different roles in different events", async () => {
      await grantRole(organizerA, eventA.id, alice, "PARTICIPANT");
      await grantRole(organizerB, eventB.id, alice, "JUDGE");

      const inA = await as(alice).get(`/api/events/${eventA.id}`).expect(200);
      expect(inA.body.viewer.roles).toContain("PARTICIPANT");
      expect(inA.body.viewer.isJudge).toBe(false);

      const inB = await as(alice).get(`/api/events/${eventB.id}`).expect(200);
      expect(inB.body.viewer.roles).toContain("JUDGE");
      expect(inB.body.viewer.isParticipant).toBe(false);
    });

    it("does not let a judge in one event act as a judge in another", async () => {
      const ctx = await as(alice).get(`/api/events/${eventA.id}`).expect(200);
      expect(ctx.body.viewer.isJudge).toBe(false);
    });
  });

  describe("organizer capability", () => {
    it("refuses event creation to a participant account", async () => {
      await as(alice).post("/api/events").send({ name: "Sneaky Event" }).expect(403);
    });

    it("allows event creation to an organizer account", async () => {
      await as(organizerA).post("/api/events").send({ name: "Another Event" }).expect(201);
    });
  });

  describe("cross-event isolation", () => {
    it("stops organizer B from editing organizer A's event", async () => {
      await as(organizerB)
        .patch(`/api/events/${eventA.id}`)
        .send({ name: "Hijacked" })
        .expect(403);
    });

    it("stops organizer B from granting roles in organizer A's event", async () => {
      await as(organizerB)
        .post(`/api/events/${eventA.id}/members`)
        .send({ email: bob.email, role: "ADMIN" })
        .expect(403);
    });

    it("stops organizer B from reading organizer A's member list", async () => {
      await as(organizerB).get(`/api/events/${eventA.id}/members`).expect(403);
    });

    it("stops organizer B from creating tracks in organizer A's event", async () => {
      await as(organizerB)
        .post(`/api/events/${eventA.id}/tracks`)
        .send({ name: "Injected Track" })
        .expect(403);
    });
  });

  describe("participants and judges cannot reach admin endpoints", () => {
    it("refuses the member list to a participant", async () => {
      await as(alice).get(`/api/events/${eventA.id}/members`).expect(403);
    });

    it("refuses the member list to a judge", async () => {
      await as(alice).get(`/api/events/${eventB.id}/members`).expect(403);
    });

    it("refuses role grants to a participant", async () => {
      await as(alice)
        .post(`/api/events/${eventA.id}/members`)
        .send({ email: bob.email, role: "JUDGE" })
        .expect(403);
    });

    it("refuses event edits to a participant", async () => {
      await as(alice).patch(`/api/events/${eventA.id}`).send({ name: "Nope" }).expect(403);
    });
  });

  describe("anonymous access", () => {
    it("allows the public event page", async () => {
      await anon().get(`/api/events/${eventA.slug}`).expect(200);
    });

    it("refuses admin endpoints", async () => {
      await anon().get(`/api/events/${eventA.id}/members`).expect(401);
      await anon().post(`/api/events/${eventA.id}/tracks`).send({ name: "x" }).expect(401);
    });
  });

  describe("forged credentials", () => {
    it("rejects a token signed with the wrong secret", async () => {
      const forged =
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9." +
        "eyJzdWIiOiIwMDAwMDAwMC0wMDAwLTAwMDAtMDAwMC0wMDAwMDAwMDAwMDAiLCJ0diI6MH0." +
        "invalid-signature";
      await anon()
        .get(`/api/events/${eventA.id}/members`)
        .set("Authorization", `Bearer ${forged}`)
        .expect(401);
    });

    it("ignores a client-supplied role in the request body", async () => {
      await as(alice)
        .patch(`/api/events/${eventA.id}`)
        .send({ name: "Escalated", role: "ADMIN", isEventAdmin: true })
        .expect(403);
    });
  });

  describe("role grants", () => {
    it("refuses to revoke the owner's admin role", async () => {
      const members = await as(organizerA)
        .get(`/api/events/${eventA.id}/members`)
        .expect(200);
      const ownerRow = members.body.find(
        (m: { user: { id: string }; role: string }) =>
          m.user.id === organizerA.id && m.role === "ADMIN",
      );
      await as(organizerA)
        .delete(`/api/events/${eventA.id}/members/${ownerRow.id}`)
        .expect(400);
    });

    it("revokes a granted role and removes the capability", async () => {
      const membershipId = await grantRole(organizerA, eventA.id, bob, "ADMIN");
      await as(bob).get(`/api/events/${eventA.id}/members`).expect(200);

      await as(organizerA)
        .delete(`/api/events/${eventA.id}/members/${membershipId}`)
        .expect(204);
      await as(bob).get(`/api/events/${eventA.id}/members`).expect(403);
    });
  });

  describe("private events", () => {
    it("hides a private event from non-members with 404", async () => {
      const priv = await createEvent(organizerA, { name: "Private Event" });
      await as(organizerA)
        .patch(`/api/events/${priv.id}`)
        .send({ visibility: "PRIVATE" })
        .expect(200);

      await as(bob).get(`/api/events/${priv.id}`).expect(404);
      await anon().get(`/api/events/${priv.id}`).expect(404);
      await as(organizerA).get(`/api/events/${priv.id}`).expect(200);
    });
  });

  describe("audit trail", () => {
    it("records role grants and revocations", async () => {
      const entries = await prisma.auditLog.findMany({
        where: { eventId: eventA.id, action: { in: ["ROLE_GRANTED", "ROLE_REVOKED"] } },
      });
      expect(entries.length).toBeGreaterThan(0);
    });
  });
});
