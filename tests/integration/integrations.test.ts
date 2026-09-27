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

      await waitFor(() => false, 150);
      const logged = await prisma.webhookDelivery.findMany();
      expect(logged.some((d) => d.ok && d.statusCode === 204)).toBe(true);
    });

    it("does not deliver events the hook is not subscribed to", async () => {
      const before = received.length;
      await as(organizer).post(`/api/events/${event.id}/rounds`).send({ name: "Round one" }).expect(201);
      await waitFor(() => received.length > before, 400);
      expect(received.length).toBe(before);
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
    it("grants the role to known accounts and reports the rest", async () => {
      const csv = ["email,name", `${judge.email},Judge`, "nobody@example.test,Nobody", "not-an-email,Bad"].join("\n");
      const res = await as(organizer)
        .post(`/api/events/${event.id}/import/roster`)
        .send({ role: "JUDGE", csv })
        .expect(200);

      expect(res.body.granted).toEqual([judge.email]);
      expect(res.body.unknown).toEqual(["nobody@example.test"]);
      expect(res.body.invalid).toEqual(["not-an-email"]);

      const again = await as(organizer)
        .post(`/api/events/${event.id}/import/roster`)
        .send({ role: "JUDGE", csv: judge.email })
        .expect(200);
      expect(again.body.alreadyHeld).toEqual([judge.email]);
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
