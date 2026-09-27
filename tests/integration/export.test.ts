import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { toCsv } from "../../src/server/src/services/export.service.js";
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

const FUTURE = new Date(Date.now() + 7 * 24 * 60 * 60_000).toISOString();

describe("CSV export", () => {
  let organizer: TestActor;
  let judge: TestActor;
  let builder: TestActor;
  let event: { id: string; slug: string };

  beforeAll(async () => {
    await resetDatabase();
    organizer = await createOrganizer("Organizer");
    judge = await createUser({ name: "Judge" });
    builder = await createUser({ name: "Builder" });

    event = await createEvent(organizer, {
      name: "Export Event",
      submissionDeadline: FUTURE,
      judgingClosesAt: FUTURE,
      reviewsPerSubmission: 1,
    });

    await as(builder).post(`/api/events/${event.id}/register`).expect(201);
    await as(builder)
      .post(`/api/events/${event.id}/teams`)
      .send({ name: "Exporters" })
      .expect(201);
    await as(builder)
      .post(`/api/events/${event.id}/submissions`)
      .send({
        name: "Exportable, Inc",
        tagline: "A project whose name contains a comma.",
        description: "Long enough a description that the submit endpoint will accept it.",
        techTags: ["csv", "postgres"],
      })
      .expect(201);
    await as(builder).post(`/api/events/${event.id}/submissions/mine/submit`).expect(200);

    await grantRole(organizer, event.id, judge, "JUDGE");
    await as(organizer)
      .put(`/api/events/${event.id}/rubric`)
      .send({
        criteria: [
          { key: "impact", label: "Impact", weight: 60 },
          { key: "craft", label: "Craft", weight: 40 },
        ],
      })
      .expect(200);
    await as(organizer)
      .post(`/api/events/${event.id}/assignments/generate`)
      .send({ seed: 5 })
      .expect(200);

    const rubric = await anon().get(`/api/events/${event.id}/rubric`).expect(200);
    const ids = rubric.body.criteria.map((c: { id: string }) => c.id);
    const queue = await as(judge).get(`/api/events/${event.id}/judge/queue`).expect(200);

    await as(judge)
      .put(`/api/events/${event.id}/judge/scores/${queue.body.items[0].submission.id}`)
      .send({
        criteria: ids.map((id: string) => ({ criterionId: id, value: 4 })),
        comment: 'A comment with "quotes" and, a comma.',
      })
      .expect(200);

    await as(organizer)
      .post(`/api/events/${event.id}/results/normalize`)
      .send({ method: "ZSCORE" })
      .expect(201);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe("formatting", () => {
    it("quotes fields containing commas, quotes and newlines", () => {
      const csv = toCsv(["a", "b"], [["plain", 'has "quotes", and a comma']]);
      expect(csv).toContain('"has ""quotes"", and a comma"');
    });

    it("neutralizes a formula injection attempt", () => {
      const csv = toCsv(["a"], [["=cmd|'/c calc'!A1"]]);
      expect(csv).toContain("'=cmd");
    });

    it("uses CRLF line endings", () => {
      expect(toCsv(["a"], [["b"]])).toBe("a\r\nb\r\n");
    });
  });

  describe("access control", () => {
    const paths = [
      "submissions.csv",
      "teams.csv",
      "judges.csv",
      "scores.csv",
      "results.csv",
      "audit.csv",
      "event.json",
    ];

    it("refuses every export to an anonymous caller", async () => {
      for (const path of paths) {
        await anon().get(`/api/events/${event.id}/export/${path}`).expect(401);
      }
    });

    it("refuses every export to a judge", async () => {
      for (const path of paths) {
        await as(judge).get(`/api/events/${event.id}/export/${path}`).expect(403);
      }
    });

    it("refuses every export to a participant", async () => {
      for (const path of paths) {
        await as(builder).get(`/api/events/${event.id}/export/${path}`).expect(403);
      }
    });
  });

  describe("content", () => {
    it("exports submissions with the team and tags", async () => {
      const res = await as(organizer)
        .get(`/api/events/${event.id}/export/submissions.csv`)
        .expect(200);

      expect(res.headers["content-type"]).toContain("text/csv");
      expect(res.text).toContain("submission_id,name,tagline");
      expect(res.text).toContain('"Exportable, Inc"');
      expect(res.text).toContain("csv; postgres");
    });

    it("exports teams with one row per member", async () => {
      const res = await as(organizer)
        .get(`/api/events/${event.id}/export/teams.csv`)
        .expect(200);
      expect(res.text).toContain("Exporters");
      expect(res.text).toContain("OWNER");
    });

    it("exports judges with their workload", async () => {
      const res = await as(organizer)
        .get(`/api/events/${event.id}/export/judges.csv`)
        .expect(200);
      expect(res.text).toContain("judge_id,name,email");
      expect(res.text).toContain("all tracks");
    });

    it("exports one row per criterion so the maths can be rechecked", async () => {
      const res = await as(organizer)
        .get(`/api/events/${event.id}/export/scores.csv`)
        .expect(200);

      expect(res.text).toContain("criterion_key,criterion_label,criterion_weight");
      expect(res.text).toContain("impact");
      expect(res.text).toContain("craft");
      // Both criteria at 4 of 5 gives 75 on the 0-100 scale.
      expect(res.text).toContain("75");
    });

    it("exports results with raw and normalized ranks", async () => {
      const res = await as(organizer)
        .get(`/api/events/${event.id}/export/results.csv`)
        .expect(200);
      expect(res.text).toContain("normalized_rank,raw_rank,movement");
      expect(res.text).toContain("ZSCORE");
    });

    it("exports a readable audit trail", async () => {
      const res = await as(organizer)
        .get(`/api/events/${event.id}/export/audit.csv`)
        .expect(200);
      expect(res.text).toContain("SCORE_SUBMITTED");
      expect(res.text).toContain("NORMALIZATION_RUN");
    });

    it("exports the whole event as JSON for migration", async () => {
      const res = await as(organizer)
        .get(`/api/events/${event.id}/export/event.json`)
        .expect(200);

      expect(res.body.formatVersion).toBe(1);
      expect(res.body.event.slug).toBe(event.slug);
      expect(res.body.event.submissions).toHaveLength(1);
      expect(res.body.event.scores).toHaveLength(1);
      expect(res.body.event.rubric.criteria).toHaveLength(2);
    });

    it("never includes a password hash in the JSON export", async () => {
      const res = await as(organizer)
        .get(`/api/events/${event.id}/export/event.json`)
        .expect(200);
      expect(JSON.stringify(res.body)).not.toContain("passwordHash");
      expect(JSON.stringify(res.body)).not.toContain("$argon2");
    });
  });
});
