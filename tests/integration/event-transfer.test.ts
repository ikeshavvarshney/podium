import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fixtureSchema, importFixture } from "../../src/server/src/services/fixture-import.service.js";
import { as, createOrganizer, createUser, prisma, resetDatabase, type TestActor } from "../helpers.js";

const fixture = fixtureSchema.parse(
  JSON.parse(readFileSync(fileURLToPath(new URL("../../fixtures.json", import.meta.url)), "utf8")),
);

describe("event export and import", () => {
  let owner: TestActor;
  let other: TestActor;
  let slug: string;
  let exported: Record<string, unknown>;

  beforeAll(async () => {
    await resetDatabase();
    owner = await createOrganizer("Source organizer");
    other = await createOrganizer("Destination organizer");
    ({ slug } = await importFixture(prisma, fixture, { ownerId: owner.id, passwordHash: "x" }));
    await as(owner).post(`/api/events/${slug}/results/normalize`).send({ method: "ZSCORE" }).expect(201);
    await as(owner).post(`/api/events/${slug}/results/publish`).send({ publish: true }).expect(200);
    exported = (await as(owner).get(`/api/events/${slug}/export/event.json`).expect(200)).body;
  });

  afterAll(async () => {
    await resetDatabase();
  });

  it("exports every table with people by email and no secrets", () => {
    expect(exported.formatVersion).toBe(2);
    const tables = exported.tables as Record<string, unknown[]>;
    expect(tables.Submission).toHaveLength(40);
    expect(tables.JudgeScore).toHaveLength(122);
    expect(tables.AuditLog!.length).toBeGreaterThan(0);
    expect(tables).not.toHaveProperty("Webhook");
    const people = exported.people as Array<{ email: string }>;
    expect(people.some((p) => p.email === "marek.nowak@example.org")).toBe(true);
    expect(JSON.stringify(people)).not.toContain("passwordHash");
  });

  it("imports into a new event that ranks exactly like the original", async () => {
    const res = await as(other).post("/api/events/import").send({ data: exported, slug: "sample-copy" }).expect(201);
    expect(res.body).toMatchObject({ slug: "sample-copy", peopleCreated: 0 });
    expect(res.body.counts).toMatchObject({ Submission: 40, JudgeScore: 122, Track: 8 });

    const [a, b] = await Promise.all([
      as(owner).get(`/api/events/${slug}/results/preview?method=ZSCORE`).expect(200),
      as(other).get(`/api/events/sample-copy/results/preview?method=ZSCORE`).expect(200),
    ]);
    const rows = (body: { standings: Array<{ name: string; normalizedValue: number; normalizedRank: number }> }) =>
      body.standings.map((r) => [r.name, r.normalizedRank, r.normalizedValue]);
    expect(rows(b.body)).toEqual(rows(a.body));
    expect(b.body.ballotDigest).not.toBe(a.body.ballotDigest);
    expect(b.body.latestRun.current).toBe(true);
  });

  it("keeps the published run published, and the copy's judges isolated", async () => {
    const pub = await as(other).get(`/api/events/sample-copy/results`).expect(200);
    expect(pub.body.standings).toHaveLength(40);

    const judge = await prisma.user.findUniqueOrThrow({ where: { email: "marek.nowak@example.org" } });
    const peer = await prisma.user.findUniqueOrThrow({ where: { email: "mira.kaur@example.org" } });
    const copy = await prisma.event.findUniqueOrThrow({ where: { slug: "sample-copy" } });
    expect(await prisma.judgeScore.count({ where: { eventId: copy.id, judgeId: judge.id } })).toBeGreaterThan(0);
    expect(await prisma.eventMembership.count({ where: { eventId: copy.id, userId: peer.id, role: "JUDGE" } })).toBe(1);
  });

  it("carries the audit trail over into a fresh, intact chain, and records the import", async () => {
    const chain = await as(other).get(`/api/events/sample-copy/audit/verify`).expect(200);
    expect(chain.body.ok).toBe(true);
    const copy = await prisma.event.findUniqueOrThrow({ where: { slug: "sample-copy" } });
    const last = await prisma.auditLog.findFirstOrThrow({ where: { eventId: copy.id }, orderBy: { chainSeq: "desc" } });
    expect(last.action).toBe("BULK_IMPORT");
    expect(last.summary).toContain(`imported from ${slug}`);
  });

  it("refuses a taken slug, a non-organizer and something that is not an export", async () => {
    await as(other).post("/api/events/import").send({ data: exported, slug: "sample-copy" }).expect(409);
    const plain = await createUser({ name: "Not an organizer" });
    await as(plain).post("/api/events/import").send({ data: exported, slug: "nope" }).expect(403);
    await as(other).post("/api/events/import").send({ data: { hello: "world" } }).expect(400);
  });
});
