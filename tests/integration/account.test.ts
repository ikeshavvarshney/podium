import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { anon, as, createUser, prisma, resetDatabase, type TestActor } from "../helpers.js";

describe("account self-service", () => {
  let alice: TestActor;

  beforeAll(async () => {
    await resetDatabase();
    alice = await createUser({ name: "Alice" });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("refuses profile changes from an anonymous caller", async () => {
    await anon().patch("/api/auth/me").send({ name: "Nobody" }).expect(401);
  });

  it("updates the caller's own profile and nobody else's", async () => {
    const bob = await createUser({ name: "Bob" });

    const res = await as(alice)
      .patch("/api/auth/me")
      .send({ name: "Alice Cooper", org: "Northwind", avatarHue: "plum" })
      .expect(200);

    expect(res.body.name).toBe("Alice Cooper");
    expect(res.body.org).toBe("Northwind");
    expect(res.body.avatarHue).toBe("plum");
    expect(res.body).not.toHaveProperty("passwordHash");

    const unchanged = await prisma.user.findUniqueOrThrow({ where: { id: bob.id } });
    expect(unchanged.name).toBe("Bob");
  });

  it("rejects an invalid avatar hue and an invalid link", async () => {
    await as(alice).patch("/api/auth/me").send({ avatarHue: "neon" }).expect(400);
    await as(alice).patch("/api/auth/me").send({ link: "not-a-url" }).expect(400);
  });

  it("refuses a password change without the current password", async () => {
    await as(alice)
      .post("/api/auth/password")
      .send({ currentPassword: "wrong-password-entirely", newPassword: "a-brand-new-secret" })
      .expect(401);
  });

  it("changes the password and invalidates tokens issued before the change", async () => {
    const carol = await createUser({ name: "Carol" });
    const staleToken = carol.token;

    await as(carol)
      .post("/api/auth/password")
      .send({
        currentPassword: "correct-horse-battery-staple",
        newPassword: "another-long-secret-phrase",
      })
      .expect(204);

    await anon().get("/api/auth/me").set("Authorization", `Bearer ${staleToken}`).expect(401);

    const login = await anon()
      .post("/api/auth/login")
      .send({ email: carol.email, password: "another-long-secret-phrase" })
      .expect(200);
    expect(login.body.user.id).toBe(carol.id);
  });

  it("revokes every session by bumping the token version", async () => {
    const dave = await createUser({ name: "Dave" });
    const staleToken = dave.token;

    await as(dave).post("/api/auth/sessions/revoke").send({}).expect(204);

    await anon().get("/api/auth/me").set("Authorization", `Bearer ${staleToken}`).expect(401);
  });
});

describe("device sessions", () => {
  it("lists the caller's sessions and revokes one device without touching the others", async () => {
    const eve = await createUser({ name: "Eve" });
    const second = await anon()
      .post("/api/auth/login")
      .send({ email: eve.email, password: "correct-horse-battery-staple" })
      .set("User-Agent", "Mozilla/5.0 (iPhone) Safari/605")
      .expect(200);
    const secondToken = second.body.token as string;

    const list = await as(eve).get("/api/auth/sessions").expect(200);
    expect(list.body.length).toBeGreaterThanOrEqual(2);
    const current = list.body.find((s: { current: boolean }) => s.current);
    const other = list.body.find((s: { current: boolean }) => !s.current);
    expect(current).toBeTruthy();

    await as(eve).delete(`/api/auth/sessions/${other.id}`).expect(204);
    await anon().get("/api/auth/me").set("Authorization", `Bearer ${secondToken}`).expect(401);
    await as(eve).get("/api/auth/me").expect(200);
  });

  it("refuses to revoke someone else's session", async () => {
    const frank = await createUser({ name: "Frank" });
    const grace = await createUser({ name: "Grace" });
    const graceSessions = await as(grace).get("/api/auth/sessions").expect(200);
    await as(frank).delete(`/api/auth/sessions/${graceSessions.body[0].id}`).expect(404);
  });

  it("returns the caller's own activity only", async () => {
    const heidi = await createUser({ name: "Heidi" });
    const res = await as(heidi).get("/api/auth/me/activity").expect(200);
    expect(res.body.length).toBeGreaterThan(0);
    expect(res.body.every((e: { summary: string }) => e.summary.includes("Heidi"))).toBe(true);
  });

  it("stores notification preferences", async () => {
    const ivan = await createUser({ name: "Ivan" });
    const res = await as(ivan).patch("/api/auth/me/notifications").send({ voteDigest: true }).expect(200);
    expect(res.body.voteDigest).toBe(true);
    expect(res.body.judgingReminders).toBe(true);
  });
});
