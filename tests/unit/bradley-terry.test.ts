import { describe, expect, it } from "vitest";
import { bradleyTerry, pairwiseWins } from "../../src/server/src/algorithms/bradley-terry.js";

const rankOf = (rows: ReturnType<typeof bradleyTerry>, id: string) => rows.find((r) => r.submissionId === id)!.rank;

describe("Bradley-Terry", () => {
  it("reads an ordering as the pairwise wins it implies", () => {
    expect(pairwiseWins([["a", "b", "c"]])).toEqual([
      ["a", "b"],
      ["a", "c"],
      ["b", "c"],
    ]);
  });

  it("recovers a consistent order", () => {
    const rows = bradleyTerry([["a", "b", "c"], ["b", "c", "d"], ["a", "c", "d"]], ["a", "b", "c", "d"]);
    expect(rows.map((r) => r.submissionId)).toEqual(["a", "b", "c", "d"]);
    expect(rows.reduce((s, r) => s + r.score, 0)).toBeCloseTo(0, 6);
  });

  it("values a win over a strong project above a win over a weak one", () => {
    // x and y each win once. x beat the champion; y beat the project that loses to everyone.
    const orders = [
      ["champ", "mid"], ["champ", "weak"], ["champ", "y"], ["mid", "weak"],
      ["x", "champ"], ["mid", "x"], ["weak", "x"],
      ["y", "weak"], ["mid", "y"], ["champ", "y"],
    ];
    const rows = bradleyTerry(orders, ["champ", "mid", "weak", "x", "y"]);
    expect(rankOf(rows, "x")).toBeLessThan(rankOf(rows, "y"));
  });

  it("keeps an unbeaten project finite and ignores projects nobody compared", () => {
    const rows = bradleyTerry([["a", "b"], ["a", "b"], ["a", "b"]], ["a", "b", "never"]);
    expect(rows).toHaveLength(2);
    expect(Number.isFinite(rows[0]!.score)).toBe(true);
    expect(rows[0]).toMatchObject({ submissionId: "a", wins: 3, comparisons: 3, rank: 1 });
  });

  it("gives symmetric evidence a shared rank", () => {
    const rows = bradleyTerry([["a", "b"], ["b", "a"]], ["a", "b"]);
    expect(rows[0]!.rank).toBe(1);
    expect(rows[1]!.rank).toBe(1);
  });
});
