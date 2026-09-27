import { describe, expect, it } from "vitest";
import { evenWeights, planFixtureImport, type Fixture } from "../../src/server/src/services/fixture-import.service.js";

const base: Fixture = {
  event: { id: "evt", name: "Sample Hack 2026", submissions_close: "2026-03-01T18:00:00Z" },
  tracks: [{ id: "t1", name: "Tools" }],
  judges: [
    { id: "j1", name: "A", email: "a@example.org", tracks: ["t1"] },
    { id: "j2", name: "B", email: "b@example.org", tracks: ["t1"] },
  ],
  teams: [{ id: "tm1", name: "One", members: ["m@example.org"] }],
  projects: [
    { id: "p2", team: "tm1", track: "t1", title: "Later", submitted_at: "2026-03-01T10:00:00Z" },
    { id: "p1", team: "tm1", track: "t1", title: "Earlier", submitted_at: "2026-02-28T10:00:00Z" },
  ],
  scores: [
    { judge: "j1", project: "p1", criteria: { functionality: 4, quality: 3 } },
    { judge: "j1", project: "p1", criteria: { functionality: 5, quality: 5 } },
    { judge: "j2", project: "p2", criteria: { functionality: 4, quality: 3 } },
    { judge: "jx", project: "p1", criteria: { functionality: 4, quality: 3 } },
    { judge: "j2", project: "p1", criteria: { functionality: 9, quality: 3 } },
  ],
};

describe("planFixtureImport", () => {
  const plan = planFixtureImport(base);

  it("keeps the earliest submission of a team and refuses the later one as a duplicate", () => {
    expect(plan.projects.map((p) => p.id)).toEqual(["p1"]);
    expect(plan.skipped).toContainEqual(expect.objectContaining({ kind: "project", id: "p2" }));
  });

  it("refuses repeat, unknown-judge, out-of-range and orphaned ballots rather than coercing them", () => {
    expect(plan.scores).toEqual([base.scores[0]]);
    const reasons = plan.skipped.filter((s) => s.kind === "score").map((s) => s.reason);
    expect(reasons).toHaveLength(4);
  });

  it("derives the criteria from the ballots, weighted evenly to exactly 100", () => {
    expect(plan.criteria).toEqual([
      { key: "functionality", weight: 50 },
      { key: "quality", weight: 50 },
    ]);
    expect(evenWeights(3)).toEqual([34, 33, 33]);
    expect(evenWeights(7).reduce((a, b) => a + b, 0)).toBe(100);
    expect(plan.slug).toBe("sample-hack-2026");
  });
});
