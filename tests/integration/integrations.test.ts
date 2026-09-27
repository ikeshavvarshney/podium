import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { verifyPayload } from "../../src/server/src/lib/signing.js";
import { signBody } from "../../src/server/src/services/webhook.service.js";
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

interface Received {
  body: string;
  headers: Record<string, string | string[] | undefined>;
}

const waitFor = async (check: () => boolean, ms = 3000) => {
  const start = Date.now();
  while (!check() && Date.now() - start < ms) await new Promise((r) => setTimeout(r, 25));
};

describe("integrations", () => {
  let organizer: TestActor;
  let judge: TestActor;
  let participant: TestActor;
  let event: { id: string; slug: string };
  let receiver: Server;
  let receiverUrl: string;
  const received: Received[] = [];

  beforeAll(async () => {
    await resetDatabase();
    organizer = await createOrganizer("Organizer");
    judge = await createUser({ name: "Judge" });
    participant = await createUser({ name: "Participant" });
    event = await createEvent(organizer, { name: "Integration Event" });
    await grantRole(organizer, event.id, participant, "PARTICIPANT");

    receiver = createServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        received.push({ body, headers: req.headers });
        res.writeHead(204).end();
      });
    });
    await new Promise<void>((resolve) => receiver.listen(0, "127.0.0.1", resolve));
    receiverUrl = `http://127.0.0.1:${(receiver.address() as AddressInfo).port}/hook`;
  });

  afterAll(async () => {
    receiver.close();
    await prisma.$disconnect();
  });

  describe("webhooks", () => {
    let secret: string;

    it("refuses webhook management to anyone but an event admin", async () => {
      await as(participant)
        .post(`/api/events/${event.id}/webhooks`)
        .send({ url: receiverUrl, events: ["EVENT_UPDATE_POSTED"] })
        .expect(403);
      await anon().get(`/api/events/${event.id}/webhooks`).expect(401);
    });

    it("rejects a non-http URL and an unknown event type", async () => {
      await as(organizer)
        .post(`/api/events/${event.id}/webhooks`)
        .send({ url: "ftp://example.test/x", events: ["EVENT_UPDATE_POSTED"] })
        .expect(400);
      await as(organizer)
        .post(`/api/events/${event.id}/webhooks`)
        .send({ url: receiverUrl, events: ["NOT_A_THING"] })
        .expect(400);
    });

    it("shows the secret once, then only a hint", async () => {
      const created = await as(organizer)
        .post(`/api/events/${event.id}/webhooks`)
        .send({ url: receiverUrl, events: ["EVENT_UPDATE_POSTED"] })
        .expect(201);
      secret = created.body.secret;
      expect(secret.length).toBeGreaterThan(20);

      const listed = await as(organizer).get(`/api/events/${event.id}/webhooks`).expect(200);
      expect(listed.body.hooks[0].secret).toBeUndefined();
      expect(listed.body.hooks[0].secretHint).toBe(`…${secret.slice(-4)}`);
    });

    it("delivers a subscribed event with a verifiable HMAC signature", async () => {
      await as(organizer)
        .post(`/api/events/${event.id}/updates`)
        .send({ title: "Judging opens", body: "Queues are live." })
        .expect(201);

      await waitFor(() => received.length > 0);
      expect(received).toHaveLength(1);
      const [delivery] = received;
      expect(delivery!.headers["x-podium-event"]).toBe("EVENT_UPDATE_POSTED");
      expect(delivery!.headers["x-podium-signature"]).toBe(`sha256=${signBody(secret, delivery!.body)}`);
      expect(JSON.parse(delivery!.body).eventId).toBe(event.id);

      // The delivery row is written after the receiver answers, so poll rather than sleep.
      let logged = await prisma.webhookDelivery.findMany();
      for (let i = 0; i < 60 && !logged.some((d) => d.ok && d.statusCode === 204); i++) {
        await new Promise((r) => setTimeout(r, 50));
        logged = await prisma.webhookDelivery.findMany();
      }
      expect(logged.some((d) => d.ok && d.statusCode === 204)).toBe(true);
    });

    it("does not deliver events the hook is not subscribed to", async () => {
      const before = received.length;
      await as(organizer).post(`/api/events/${event.id}/rounds`).send({ name: "Round one" }).expect(201);
      await waitFor(() => received.length > before, 400);
      expect(received.length).toBe(before);
    });

    it("offers every event-scoped action, and no account-level one", async () => {
      const res = await as(organizer).get(`/api/events/${event.id}/webhooks`).expect(200);
      expect(res.body.available[0]).toBe("*");
      expect(res.body.available).toEqual(
        expect.arrayContaining(["FAQ_CHANGED", "QUESTION_CHANGED", "ASSIGNMENT_SKIPPED", "JOIN_REQUESTED", "ACCESS_DENIED"]),
      );
      expect(res.body.available).not.toContain("USER_LOGGED_IN");
    });

    it("delivers actions a wildcard hook never named", async () => {
      await as(organizer)
        .post(`/api/events/${event.id}/webhooks`)
        .send({ url: receiverUrl, events: ["*"] })
        .expect(201);
      const before = received.length;

      await as(organizer)
        .post(`/api/events/${event.id}/faq`)
        .send({ question: "Is there food?", answer: "Yes." })
        .expect(201);
      await as(organizer)
        .post(`/api/events/${event.id}/questions`)
        .send({ prompt: "Which stack?" })
        .expect(201);

      const types = () => received.slice(before).map((r) => r.headers["x-podium-event"]);
      await waitFor(() => types().includes("FAQ_CHANGED") && types().includes("QUESTION_CHANGED"));
      expect(types()).toEqual(expect.arrayContaining(["FAQ_CHANGED", "QUESTION_CHANGED"]));
    });

    it("records a failed delivery instead of failing the request", async () => {
      await as(organizer)
        .post(`/api/events/${event.id}/webhooks`)
        .send({ url: "http://127.0.0.1:1/unreachable", events: ["ROUND_CHANGED"] })
        .expect(201);
      await as(organizer).post(`/api/events/${event.id}/rounds`).send({ name: "Round two" }).expect(201);

      await waitFor(() => false, 600);
      const failed = await prisma.webhookDelivery.findMany({ where: { ok: false } });
      expect(failed.length).toBeGreaterThan(0);
      expect(failed[0]!.error).toBeTruthy();
    });
  });

  describe("bulk import", () => {
    it("grants the role, creates accounts for new addresses and reports invalid rows", async () => {
      const csv = ["email,name", `${judge.email},Judge`, "newjudge@example.test,New Judge", "not-an-email,Bad"].join("\n");
      const res = await as(organizer)
        .post(`/api/events/${event.id}/import/roster`)
        .send({ role: "JUDGE", csv })
        .expect(200);

      expect(res.body.granted).toEqual([judge.email, "newjudge@example.test"]);
      expect(res.body.created).toEqual(["newjudge@example.test"]);
      expect(res.body.invalid).toEqual(["not-an-email"]);

      const created = await prisma.user.findUniqueOrThrow({
        where: { email: "newjudge@example.test" },
        include: { memberships: { where: { eventId: event.id } } },
      });
      expect(created.name).toBe("New Judge");
      expect(created.memberships.map((m) => m.role)).toEqual(["JUDGE"]);

      const again = await as(organizer)
        .post(`/api/events/${event.id}/import/roster`)
        .send({ role: "JUDGE", csv: judge.email })
        .expect(200);
      expect(again.body.alreadyHeld).toEqual([judge.email]);
      expect(again.body.created).toEqual([]);
    });

    it("gives created accounts no password anyone knows", async () => {
      await anon()
        .post("/api/auth/login")
        .send({ email: "newjudge@example.test", password: "New Judge" })
        .expect(401);
      const user = await prisma.user.findUniqueOrThrow({ where: { email: "newjudge@example.test" } });
      expect(user.passwordHash).toMatch(/^\$argon2id\$/);
    });

    it("places participants on named teams, creating teams and respecting the size cap", async () => {
      const small = await createEvent(organizer, { name: "Roster Event", maxTeamSize: 2 });
      const csv = [
        "name,email,team",
        '"Lovelace, Ada",ada@roster.test,Analytical',
        "Grace,grace@roster.test,Analytical",
        "Third,third@roster.test,Analytical",
        "Solo,solo@roster.test,",
        "Kay,kay@roster.test,Smalltalk",
      ].join("\n");
      const res = await as(organizer)
        .post(`/api/events/${small.id}/import/roster`)
        .send({ role: "PARTICIPANT", csv })
        .expect(200);

      expect(res.body.created).toHaveLength(5);
      expect(res.body.teams.created).toEqual(["Analytical", "Smalltalk"]);
      expect(res.body.teams.joined).toEqual([
        { email: "ada@roster.test", team: "Analytical" },
        { email: "grace@roster.test", team: "Analytical" },
        { email: "kay@roster.test", team: "Smalltalk" },
      ]);
      expect(res.body.teams.skipped).toEqual([
        { email: "third@roster.test", team: "Analytical", reason: "team is full (maximum 2)" },
      ]);

      const team = await prisma.team.findFirstOrThrow({
        where: { eventId: small.id, name: "Analytical" },
        include: { members: { include: { user: true }, orderBy: { joinedAt: "asc" } } },
      });
      expect(team.members.map((m) => [m.user.name, m.role])).toEqual([
        ["Lovelace, Ada", "OWNER"],
        ["Grace", "MEMBER"],
      ]);

      const rerun = await as(organizer)
        .post(`/api/events/${small.id}/import/roster`)
        .send({ role: "PARTICIPANT", csv: "email,team\nada@roster.test,Smalltalk" })
        .expect(200);
      expect(rerun.body.teams.skipped).toEqual([
        { email: "ada@roster.test", team: "Smalltalk", reason: 'already on team "Analytical"' },
      ]);
    });

    it("refuses import to non-admins and refuses the admin role", async () => {
      await as(judge)
        .post(`/api/events/${event.id}/import/roster`)
        .send({ role: "JUDGE", csv: participant.email })
        .expect(403);
      await as(organizer)
        .post(`/api/events/${event.id}/import/roster`)
        .send({ role: "ADMIN", csv: participant.email })
        .expect(400);
    });
  });

  describe("certificates", () => {
    it("issues a signed certificate to someone who took part", async () => {
      const res = await as(participant).get(`/api/events/${event.id}/certificates/me`).expect(200);
      expect(res.body.payload.holder.id).toBe(participant.id);
      expect(res.body.payload.roles).toContain("PARTICIPANT");
      expect(verifyPayload(res.body.payload, res.body.signature)).toBe(true);
    });

    it("refuses a certificate to someone with no part in the event", async () => {
      const outsider = await createUser({ name: "Outsider" });
      await as(outsider).get(`/api/events/${event.id}/certificates/me`).expect(403);
    });
  });
});
