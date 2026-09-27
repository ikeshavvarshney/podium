import { describe, expect, it } from "vitest";
import { bordaCount, buildGroups, groupKey } from "../../src/server/src/algorithms/pairwise.js";

const ids = (n: number) => Array.from({ length: n }, (_, i) => `s${i}`);

describe("group building", () => {
  it("splits assignments into groups of the configured size", () => {
    const groups = buildGroups(ids(9), 3, "judge-a");
    expect(groups).toHaveLength(3);
    expect(groups.every((g) => g.submissionIds.length === 3)).toBe(true);
  });

  it("is deterministic for one judge and different across judges", () => {
    const a1 = buildGroups(ids(8), 4, "judge-a").map((g) => g.key);
    const a2 = buildGroups(ids(8), 4, "judge-a").map((g) => g.key);
    const b = buildGroups(ids(8), 4, "judge-b").map((g) => g.key);

    expect(a1).toEqual(a2);
    expect(a1).not.toEqual(b);
  });

  it("never leaves a trailing group of one", () => {
    const groups = buildGroups(ids(7), 3, "judge-c");
    expect(groups.every((g) => g.submissionIds.length >= 2)).toBe(true);
  });

  it("clamps the group size into the supported range", () => {
    expect(buildGroups(ids(10), 1, "j")[0]!.submissionIds).toHaveLength(2);
    expect(buildGroups(ids(20), 99, "j")[0]!.submissionIds).toHaveLength(6);
  });

  it("returns nothing when there is nothing to compare", () => {
    expect(buildGroups(["only"], 3, "j")).toEqual([]);
    expect(buildGroups([], 3, "j")).toEqual([]);
  });

  it("identifies a group independently of the order it is shown in", () => {
    expect(groupKey(["b", "a", "c"])).toBe(groupKey(["c", "b", "a"]));
  });
});

describe("Borda count", () => {
  it("awards k-1 down to 0 within a group", () => {
    const rows = bordaCount([{ order: ["a", "b", "c"] }], ["a", "b", "c"]);
    expect(rows.find((r) => r.submissionId === "a")!.points).toBe(2);
    expect(rows.find((r) => r.submissionId === "b")!.points).toBe(1);
    expect(rows.find((r) => r.submissionId === "c")!.points).toBe(0);
  });

  it("ranks on the normalized score, not on raw points", () => {
    // "a" appears twice and wins both; "d" wins its only group.
    const rows = bordaCount(
      [{ order: ["a", "b"] }, { order: ["a", "c"] }, { order: ["d", "e"] }],
      ["a", "b", "c", "d", "e"],
    );
    expect(rows[0]!.score).toBe(1);
    expect(rows[0]!.rank).toBe(1);
    expect(rows.find((r) => r.submissionId === "d")!.rank).toBe(1);
    expect(rows.find((r) => r.submissionId === "a")!.points).toBe(2);
  });

  it("counts appearances and firsts", () => {
    const rows = bordaCount([{ order: ["a", "b"] }, { order: ["b", "a"] }], ["a", "b"]);
    const a = rows.find((r) => r.submissionId === "a")!;
    expect(a.appearances).toBe(2);
    expect(a.firsts).toBe(1);
    expect(a.score).toBeCloseTo(0.5);
  });

  it("gives tied projects the same rank", () => {
    const rows = bordaCount([{ order: ["a", "b"] }, { order: ["b", "a"] }], ["a", "b"]);
    expect(rows[0]!.rank).toBe(1);
    expect(rows[1]!.rank).toBe(1);
  });

  it("ignores degenerate rankings and unknown projects", () => {
    const rows = bordaCount([{ order: ["a"] }, { order: ["zz", "a"] }], ["a", "b"]);
    expect(rows.find((r) => r.submissionId === "a")!.appearances).toBe(1);
    expect(rows.find((r) => r.submissionId === "b")!.score).toBe(0);
  });

  it("scores zero for a project nobody ranked", () => {
    const rows = bordaCount([], ["a", "b"]);
    expect(rows.every((r) => r.score === 0 && r.appearances === 0)).toBe(true);
  });
});
