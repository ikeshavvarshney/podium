import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { rateLimitStore } from "../../src/server/src/middleware/rate-limit.js";
import { anon, createUser, prisma, resetDatabase, type TestActor } from "../helpers.js";

/** The route only logs the token, so tests read the row the way the link does. */
async function latestTokenFor(userId: string): Promise<string | null> {
  const row = await prisma.signInToken.findFirst({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });
  return row?.tokenHash ?? null;
}

describe("passwordless sign-in links", () => {
  let alice: TestActor;

  beforeAll(async () => {
    await resetDatabase();
    rateLimitStore.reset();
    alice = await createUser({ name: "Alice" });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("accepts a request for an unknown address without revealing anything", async () => {
    const res = await anon()
      .post("/api/auth/magic-link")
      .send({ email: "nobody@example.test" })
      .expect(202);

    expect(res.body.message).toMatch(/if that address has an account/i);
    expect(await prisma.signInToken.count()).toBe(0);
  });

  it("stores only a hash of the issued token", async () => {
    await anon().post("/api/auth/magic-link").send({ email: alice.email }).expect(202);

    const row = await prisma.signInToken.findFirstOrThrow({ where: { userId: alice.id } });
    expect(row.tokenHash).toHaveLength(64);
    expect(row.usedAt).toBeNull();
    expect(row.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("refuses a token that was never issued", async () => {
    await anon()
      .post("/api/auth/magic-link/consume")
      .send({ token: "not-a-real-token-value" })
      .expect(401);
  });

  it("signs in with a valid link and refuses to reuse it", async () => {
    const token = "integration-token-" + Date.now();
    await prisma.signInToken.create({
      data: {
        userId: alice.id,
        tokenHash: createHash("sha256").update(token).digest("hex"),
        expiresAt: new Date(Date.now() + 60_000),
      },
    });

    const res = await anon().post("/api/auth/magic-link/consume").send({ token }).expect(200);
    expect(res.body.user.id).toBe(alice.id);
    expect(res.headers["set-cookie"]?.join()).toContain("podium_session");

    await anon().post("/api/auth/magic-link/consume").send({ token }).expect(401);
  });

  it("refuses an expired link", async () => {
    const token = "expired-token-" + Date.now();
    await prisma.signInToken.create({
      data: {
        userId: alice.id,
        tokenHash: createHash("sha256").update(token).digest("hex"),
        expiresAt: new Date(Date.now() - 1000),
      },
    });

    await anon().post("/api/auth/magic-link/consume").send({ token }).expect(401);
    expect(await latestTokenFor(alice.id)).toBeTruthy();
  });

  it("records the issue in the audit log", async () => {
    const entry = await prisma.auditLog.findFirst({ where: { action: "SIGN_IN_LINK_ISSUED" } });
    expect(entry?.actorId).toBe(alice.id);
  });
});
