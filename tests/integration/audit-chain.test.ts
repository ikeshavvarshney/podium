import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, createEvent, createOrganizer, createUser, grantRole, prisma, resetDatabase, type TestActor } from "../helpers.js";

describe("audit log: append-only hash chain", () => {
  let organizer: TestActor;
  let event: { id: string; slug: string };

  beforeAll(async () => {
    await resetDatabase();
    organizer = await createOrganizer("Chain owner");
    event = await createEvent(organizer, { name: "Chain Event" });
    const judge = await createUser({ name: "Chain judge" });
    await grantRole(organizer, event.id, judge, "JUDGE");
    await as(judge).get(`/api/events/${event.id}/judges/${organizer.id}/scores`).expect(403);
  });

  afterAll(async () => {
    await resetDatabase();
  });

  it("chains every entry and verifies clean", async () => {
    const rows = await prisma.auditLog.findMany({ where: { eventId: event.id }, orderBy: { chainSeq: "asc" } });
    expect(rows.length).toBeGreaterThanOrEqual(3);
    expect(rows.map((r) => r.chainSeq)).toEqual(rows.map((_, i) => i + 1));
    expect(rows[0]!.prevHash).toBe("genesis");
    for (let i = 1; i < rows.length; i += 1) expect(rows[i]!.prevHash).toBe(rows[i - 1]!.hash);

    const res = await as(organizer).get(`/api/events/${event.id}/audit/verify`).expect(200);
    expect(res.body).toMatchObject({ ok: true, entries: rows.length, head: rows.at(-1)!.hash });
  });

  it("refuses to update or delete an entry, even with direct SQL", async () => {
    await expect(
      prisma.$executeRaw`UPDATE "audit_logs" SET "summary" = 'nothing happened' WHERE "event_id" = ${event.id}::uuid`,
    ).rejects.toThrow(/append-only/);
    await expect(prisma.$executeRaw`DELETE FROM "audit_logs" WHERE "event_id" = ${event.id}::uuid`).rejects.toThrow(
      /append-only/,
    );
  });

  it("detects an entry rewritten behind the triggers' back", async () => {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`ALTER TABLE "audit_logs" DISABLE TRIGGER "audit_logs_append_only"`);
      await tx.$executeRaw`UPDATE "audit_logs" SET "summary" = 'rewritten' WHERE "event_id" = ${event.id}::uuid AND "chain_seq" = 2`;
      await tx.$executeRawUnsafe(`ALTER TABLE "audit_logs" ENABLE TRIGGER "audit_logs_append_only"`);
    });
    const res = await as(organizer).get(`/api/events/${event.id}/audit/verify`).expect(200);
    expect(res.body.ok).toBe(false);
    expect(res.body.firstBreak).toMatchObject({ chainSeq: 2, reason: "the entry was changed after it was written" });
  });

  it("still lets a whole event be deleted, taking its trail with it", async () => {
    const doomed = await createEvent(organizer, { name: "Short-lived" });
    expect(await prisma.auditLog.count({ where: { eventId: doomed.id } })).toBeGreaterThan(0);
    await prisma.event.delete({ where: { id: doomed.id } });
    expect(await prisma.auditLog.count({ where: { eventId: doomed.id } })).toBe(0);
  });

  it("refuses the chain status to anyone but an organizer", async () => {
    const outsider = await createUser({ name: "Nosy" });
    await as(outsider).get(`/api/events/${event.id}/audit/verify`).expect(403);
  });
});
