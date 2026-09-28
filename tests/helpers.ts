import type { Express } from "express";
import request from "supertest";
import { createApp } from "../src/server/src/app.js";
import { prisma } from "../src/server/src/db.js";

export const app: Express = createApp();

/** Order matters: children before parents. */
const TABLES = [
  "api_tokens",
  "uploads",
  "webhook_outbox",
  "rate_limit_buckets",
  "webhook_deliveries",
  "webhooks",
  "criterion_scores",
  "judge_scores",
  "judge_assignments",
  "pairwise_rankings",
  "normalized_scores",
  "normalization_runs",
  "rubric_criteria",
  "rubrics",
  "submission_custom_answers",
  "custom_questions",
  "submission_images",
  "voter_verifications",
  "votes",
  "comments",
  "submissions",
  "join_requests",
  "seeker_listings",
  "team_invites",
  "team_members",
  "teams",
  "prizes",
  "rounds",
  "faq_items",
  "event_people",
  "partners",
  "challenges",
  "tracks",
  "voting_configs",
  "update_reads",
  "registrations",
  "event_updates",
  "audit_logs",
  "sign_in_tokens",
  "event_memberships",
  "events",
  "sessions",
  "users",
];

export async function resetDatabase(): Promise<void> {
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE ${TABLES.map((t) => `"${t}"`).join(", ")} RESTART IDENTITY CASCADE`,
  );
}

export interface TestActor {
  id: string;
  email: string;
  name: string;
  token: string;
}

let seq = 0;

export async function createUser(
  overrides: { name?: string; accountType?: "user" | "organizer" } = {},
): Promise<TestActor> {
  seq += 1;
  const email = `user${seq}-${Date.now()}@example.test`;
  const res = await request(app)
    .post("/api/auth/register")
    .send({
      email,
      password: "correct-horse-battery-staple",
      name: overrides.name ?? `User ${seq}`,
      accountType: overrides.accountType ?? "user",
    })
    .expect(201);

  return { id: res.body.user.id, email, name: res.body.user.name, token: res.body.token };
}

export const createOrganizer = (name?: string) =>
  createUser({ name, accountType: "organizer" });

/** Authenticated request helper. Tokens go in the Authorization header. */
export function as(actor: TestActor) {
  const agent = request(app);
  const auth = `Bearer ${actor.token}`;
  return {
    get: (url: string) => agent.get(url).set("Authorization", auth),
    post: (url: string) => agent.post(url).set("Authorization", auth),
    put: (url: string) => agent.put(url).set("Authorization", auth),
    patch: (url: string) => agent.patch(url).set("Authorization", auth),
    delete: (url: string) => agent.delete(url).set("Authorization", auth),
  };
}

export const anon = () => request(app);

export async function createEvent(
  organizer: TestActor,
  overrides: Record<string, unknown> = {},
): Promise<{ id: string; slug: string }> {
  seq += 1;
  const res = await as(organizer)
    .post("/api/events")
    .send({
      name: `Test Event ${seq}`,
      status: "PUBLISHED",
      ...overrides,
    })
    .expect(201);

  // Events are created as DRAFT; publish unless the test asked otherwise.
  if (!("status" in overrides)) {
    await as(organizer).patch(`/api/events/${res.body.id}`).send({ status: "PUBLISHED" });
  }
  return { id: res.body.id, slug: res.body.slug };
}

export async function grantRole(
  admin: TestActor,
  eventId: string,
  target: TestActor,
  role: "PARTICIPANT" | "JUDGE" | "ADMIN",
  trackScope: string[] = [],
): Promise<string> {
  const res = await as(admin)
    .post(`/api/events/${eventId}/members`)
    .send({ email: target.email, role, trackScope })
    .expect(201);
  return res.body.id;
}

export async function createTrack(
  admin: TestActor,
  eventId: string,
  name: string,
): Promise<string> {
  const res = await as(admin)
    .post(`/api/events/${eventId}/tracks`)
    .send({ name })
    .expect(201);
  return res.body.id;
}

export { prisma };
