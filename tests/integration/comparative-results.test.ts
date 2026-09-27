import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, anon, createEvent, createOrganizer, createUser, prisma, resetDatabase, type TestActor } from "../helpers.js";

describe("comparative judging flows into results", () => {
  let organizer: TestActor;
  let event: { id: string; slug: string };
  const ids: string[] = [];

  beforeAll(async () => {
    await resetDatabase();
    organizer = await createOrganizer("Organizer");
    const judge = await createUser({ name: "Judge" });
    event = await createEvent(organizer, { name: "Comparative Event" });

    await prisma.rubric.create({ data: { eventId: event.id, name: "Comparative", mode: "COMPARATIVE", groupSize: 3 } });

    for (const name of ["Ash", "Elm", "Oak"]) {
      const member = await createUser({ name: `${name} owner` });
      const team = await prisma.team.create({
        data: { eventId: event.id, name, members: { create: [{ userId: member.id, role: "OWNER" }] } },
      });
      const sub = await prisma.submission.create({
        data: { eventId: event.id, teamId: team.id, name, status: "SUBMITTED", declarations: {} },
      });
      ids.push(sub.id);
    }
    // One finished group, best to worst: Elm, Oak, Ash.
    await prisma.pairwiseRanking.create({
      data: { eventId: event.id, judgeId: judge.id, groupKey: "g1", order: [ids[1]!, ids[2]!, ids[0]!] },
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("previews the Borda order for every normalization method", async () => {
    for (const method of ["RAW", "ZSCORE", "RANK_AVERAGE"]) {
      const res = await as(organizer).get(`/api/events/${event.id}/results/preview?method=${method}`).expect(200);
      const names = res.body.standings.map((s: { name: string }) => s.name);
      expect(names).toEqual(["Elm", "Oak", "Ash"]);
      expect(res.body.ballotCount).toBe(1);
    }
  });

  it("runs, publishes and shows the comparative standings publicly", async () => {
    await as(organizer).post(`/api/events/${event.id}/results/normalize`).send({ method: "ZSCORE" }).expect(201);
    await as(organizer).post(`/api/events/${event.id}/results/publish`).send({ publish: true }).expect(200);
    const res = await anon().get(`/api/events/${event.id}/results`).expect(200);
    expect(res.body.standings.map((s: { submission: { name: string } }) => s.submission.name)).toEqual(["Elm", "Oak", "Ash"]);
  });
});
