import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signFixedToken } from "../../src/server/src/lib/jwt.js";
import {
  fixtureSchema,
  importFixture,
  stableUserId,
  type Fixture,
} from "../../src/server/src/services/fixture-import.service.js";
import { anon, app, createOrganizer, prisma, resetDatabase } from "../helpers.js";

/**
 * Loads the real fixtures.json and replays the acceptance checker's seven probes against it,
 * using the same fixed tokens the seed prints for .dogfood.toml.
 */
const fixture: Fixture = fixtureSchema.parse(
  JSON.parse(readFileSync(fileURLToPath(new URL("../../fixtures.json", import.meta.url)), "utf8")),
);

const header = (userId: string) =>
  `Bearer ${signFixedToken(userId, 0, new Date("2026-03-01T18:00:00Z"), new Date("2029-03-01T18:00:00Z"))}`;
const get = (url: string, userId?: string) => {
  const r = request(app).get(url);
  return userId ? r.set("Authorization", header(userId)) : r;
};

describe("fixtures.json import and the acceptance checker probes", () => {
  let slug: string;
  let organizerId: string;
  const judgeA = stableUserId("marek.nowak@example.org");
  const judgeB = stableUserId("mira.kaur@example.org");
  const participant = stableUserId("priya1@example.org");

  beforeAll(async () => {
    await resetDatabase();
    const organizer = await createOrganizer("Fixture organizer");
    organizerId = organizer.id;
    const result = await importFixture(prisma, fixture, { ownerId: organizer.id, passwordHash: "x" });
    slug = result.slug;
  });

  afterAll(async () => {
    await resetDatabase();
  });

  it("imports every project but the duplicate, and every ballot on an imported project", async () => {
    const event = await prisma.event.findUniqueOrThrow({ where: { slug } });
    expect(await prisma.submission.count({ where: { eventId: event.id } })).toBe(40);
    expect(await prisma.judgeScore.count({ where: { eventId: event.id } })).toBe(122);
    expect(await prisma.track.count({ where: { eventId: event.id } })).toBe(8);
    expect(await prisma.eventMembership.count({ where: { eventId: event.id, role: "JUDGE" } })).toBe(30);

    const audit = await prisma.auditLog.findFirstOrThrow({ where: { eventId: event.id, action: "BULK_IMPORT" } });
    expect(audit.summary).toContain("prj_41");
    expect(audit.summary).toContain("duplicate submission");
  });

  it("T1: the gallery is public and shows fixture projects", async () => {
    const res = await anon().get(`/api/events/${slug}/submissions?take=100`).expect(200);
    const body = JSON.stringify(res.body);
    for (const p of fixture.projects.slice(0, 3)) expect(body).toContain(p.title);
  });

  it("T1: the closed event refuses a submission from a participant", async () => {
    const res = await request(app)
      .post(`/api/events/${slug}/submissions`)
      .set("Authorization", header(participant))
      .send({ title: "dogfood-late-submission-probe", summary: "probe" });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });

  it("T2: a judge reads their own scores", async () => {
    const res = await get(`/api/events/${slug}/judges/me/scores`, judgeA).expect(200);
    expect(res.body.scores.length).toBeGreaterThan(0);
  });

  it("T2: a judge is refused a peer's scores, and the probe is audited", async () => {
    await get(`/api/events/${slug}/judges/${judgeA}/scores`, judgeB).expect(403);
    const denied = await prisma.auditLog.count({ where: { action: "ACCESS_DENIED", actorId: judgeB } });
    expect(denied).toBe(1);
  });

  it("T2: a participant is not a judge", async () => {
    await get(`/api/events/${slug}/judges/me/scores`, participant).expect(403);
    await get(`/api/events/${slug}/judges/${judgeA}/scores`, participant).expect(403);
  });

  it("T2: signed out gets 401", async () => {
    await anon().get(`/api/events/${slug}/judges/${judgeA}/scores`).expect(401);
  });

  it("T2: an organizer reads any judge's scores and exports CSV", async () => {
    await get(`/api/events/${slug}/judges/${judgeA}/scores`, organizerId).expect(200);
    const csv = await get(`/api/events/${slug}/export/scores.csv`, organizerId).expect(200);
    expect(csv.text.split("\n")[0]).toContain(",");
  });

  it("gives fixture accounts the same id on every import", () => {
    expect(stableUserId("Marek.Nowak@example.org")).toBe(judgeA);
    expect(judgeA).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
