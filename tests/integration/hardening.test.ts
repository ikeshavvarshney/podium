import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { rateLimitStore } from "../../src/server/src/middleware/rate-limit.js";
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
    rateLimitStore.reset();
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

  describe("forwarded headers", () => {
    it("does not let a spoofed X-Forwarded-For escape the sign-in rate limit", async () => {
      rateLimitStore.reset();
      const attempt = (i: number) =>
        anon()
          .post("/api/auth/login")
          .set("X-Forwarded-For", `203.0.113.${i}`)
          .send({ email: "nobody@example.test", password: "wrong-password" });

      for (let i = 1; i <= 20; i++) await attempt(i).expect(401);
      await attempt(21).expect(429);
      rateLimitStore.reset();
    });
  });
});
