import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { initSecrets } from "../../src/server/src/lib/instance-secrets.js";
import {
  anon,
  app,
  as,
  createEvent,
  createOrganizer,
  createUser,
  grantRole,
  prisma,
  resetDatabase,
  type TestActor,
} from "../helpers.js";

const bearer = (token: string) => ({ get: (url: string) => request(app).get(url).set("Authorization", `Bearer ${token}`), post: (url: string) => request(app).post(url).set("Authorization", `Bearer ${token}`) });

describe("API tokens and instance secrets", () => {
  let organizer: TestActor;
  let judge: TestActor;
  let event: { id: string; slug: string };
  let other: { id: string; slug: string };

  beforeAll(async () => {
    await resetDatabase();
    organizer = await createOrganizer("Token owner");
    judge = await createUser({ name: "Token judge" });
    event = await createEvent(organizer, { name: "Token Event" });
    other = await createEvent(organizer, { name: "Other Event" });
    await grantRole(organizer, event.id, judge, "JUDGE");
  });

  afterAll(async () => {
    await resetDatabase();
  });

  it("generates instance secrets once and keeps them across boots", async () => {
    await initSecrets(prisma);
    const first = await prisma.instanceSecret.findMany({ orderBy: { name: "asc" } });
    await initSecrets(prisma);
    const second = await prisma.instanceSecret.findMany({ orderBy: { name: "asc" } });
    expect(first.map((s) => s.name)).toEqual(["record_signing", "session"]);
    expect(second.map((s) => s.value)).toEqual(first.map((s) => s.value));
    expect(first[0]!.value).not.toBe(first[1]!.value);
  });

  it("issues a token once, and lists it only by prefix", async () => {
    const res = await as(organizer).post("/api/auth/tokens").send({ name: "ci" }).expect(201);
    expect(res.body.token).toMatch(/^pod_/);
    const list = await as(organizer).get("/api/auth/tokens").expect(200);
    expect(JSON.stringify(list.body)).not.toContain(res.body.token);
    expect(list.body[0].prefix).toBe(res.body.token.slice(0, 12));

    await bearer(res.body.token).get("/api/auth/me").expect(200);
  });

  it("refuses to let a token mint another token", async () => {
    const res = await as(organizer).post("/api/auth/tokens").send({ name: "parent" }).expect(201);
    await bearer(res.body.token).post("/api/auth/tokens").send({ name: "child" }).expect(403);
  });

  it("acts only inside its event, and without organizer capability", async () => {
    const res = await as(organizer).post("/api/auth/tokens").send({ name: "scoped", event: event.slug }).expect(201);
    const token = res.body.token as string;

    await bearer(token).get(`/api/events/${event.slug}/progress`).expect(200);
    await bearer(token).get(`/api/events/${event.id}/progress`).expect(200);
    await bearer(token).get(`/api/events/${other.slug}/progress`).expect(401);
    await bearer(token).get("/api/auth/me").expect(401);
    await bearer(token).post("/api/events").send({ name: "Minted by a token" }).expect(401);
  });

  it("refuses to scope a token to an event the caller is not part of", async () => {
    const outsider = await createUser({ name: "Outsider" });
    await as(outsider).post("/api/auth/tokens").send({ name: "nope", event: event.slug }).expect(400);
  });

  it("stops working once revoked, and the revocation is audited", async () => {
    const res = await as(judge).post("/api/auth/tokens").send({ name: "judge script", event: event.slug }).expect(201);
    await bearer(res.body.token).get(`/api/events/${event.slug}/judge/queue`).expect(200);
    await as(judge).delete(`/api/auth/tokens/${res.body.id}`).expect(204);
    await bearer(res.body.token).get(`/api/events/${event.slug}/judge/queue`).expect(401);

    const audit = await prisma.auditLog.findFirst({ where: { action: "API_TOKEN_REVOKED", actorId: judge.id } });
    expect(audit?.summary).toContain("judge script");
  });

  it("ignores an unknown or malformed token", async () => {
    await bearer("pod_not-a-real-token").get("/api/auth/me").expect(401);
    await anon().get("/api/auth/tokens").expect(401);
  });
});
