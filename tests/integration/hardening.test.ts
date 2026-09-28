import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MAX_FAILURES_PER_ACCOUNT, PostgresStore, rateLimitStore } from "../../src/server/src/middleware/rate-limit.js";
import {
  anon,
  as,
  createEvent,
  createOrganizer,
  prisma,
  resetDatabase,
  type TestActor,
} from "../helpers.js";

describe("request hardening", () => {
  let organizer: TestActor;
  let event: { id: string; slug: string };

  beforeAll(async () => {
    await resetDatabase();
    await rateLimitStore.reset();
    organizer = await createOrganizer("Organizer");
    event = await createEvent(organizer, { name: "Hardening Event" });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe("malformed ids", () => {
    it.each([
      "submissions/not-a-uuid",
      "submissions/not-a-uuid/comments",
      "teams/not-a-uuid",
    ])("answers 404, not 500, for /%s", async (path) => {
      const res = await as(organizer).get(`/api/events/${event.slug}/${path}`).expect(404);
      expect(res.body.error.code).toBe("not_found");
    });

    it("answers 404 to an anonymous caller too", async () => {
      await anon().get(`/api/events/${event.slug}/submissions/not-a-uuid`).expect(404);
    });
  });

  describe("sign-in limits", () => {
    const login = (email: string, password: string, forwardedFor?: string) => {
      const req = anon().post("/api/auth/login");
      if (forwardedFor) req.set("X-Forwarded-For", forwardedFor);
      return req.send({ email, password });
    };

    it("does not let a spoofed X-Forwarded-For escape the failed sign-in limit", async () => {
      await rateLimitStore.reset();
      for (let i = 1; i <= MAX_FAILURES_PER_ACCOUNT; i++) {
        await login(organizer.email, "wrong-password", `203.0.113.${i}`).expect(401);
      }
      const res = await login(organizer.email, "wrong-password", "203.0.113.99").expect(429);
      expect(res.headers["retry-after"]).toBeTruthy();
      // The right password is refused too while the account is cooling down from this address.
      await login(organizer.email, "correct-horse-battery-staple").expect(429);
      await rateLimitStore.reset();
    });

    it("lets a room full of people sign in from one address", async () => {
      await rateLimitStore.reset();
      for (let i = 0; i < 40; i++) await login(organizer.email, "correct-horse-battery-staple").expect(200);
    });

    it("forgets earlier failures once the account signs in", async () => {
      await rateLimitStore.reset();
      for (let i = 0; i < MAX_FAILURES_PER_ACCOUNT - 1; i++) await login(organizer.email, "wrong-password").expect(401);
      await login(organizer.email, "correct-horse-battery-staple").expect(200);
      for (let i = 0; i < MAX_FAILURES_PER_ACCOUNT - 1; i++) await login(organizer.email, "wrong-password").expect(401);
      await login(organizer.email, "correct-horse-battery-staple").expect(200);
      await rateLimitStore.reset();
    });
  });

  describe("shared rate-limit store", () => {
    it("counts windows in Postgres so every replica sees the same numbers", async () => {
      const store = new PostgresStore();
      await store.reset();
      expect((await store.hit("probe", 60_000)).count).toBe(1);
      expect((await store.hit("probe", 60_000)).count).toBe(2);
      expect((await store.peek("probe"))?.count).toBe(2);
      await store.clear("probe");
      expect(await store.peek("probe")).toBeNull();
      const short = await store.hit("short", 1);
      await new Promise((r) => setTimeout(r, 20));
      expect((await store.hit("short", 60_000)).count).toBe(1);
      expect(short.count).toBe(1);
    });
  });
});
