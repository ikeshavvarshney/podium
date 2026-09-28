import { describe, expect, it } from "vitest";
import { panelIntegrity } from "../../src/server/src/algorithms/integrity.js";
import type { Ballot } from "../../src/server/src/algorithms/normalization.js";

const b = (judgeId: string, submissionId: string, total: number): Ballot => ({ judgeId, submissionId, total });

describe("panel integrity", () => {
  it("flags two judges who give identical totals across their shared projects", () => {
    const ballots = [
      b("j1", "a", 80), b("j1", "b", 60), b("j1", "c", 40),
      b("j2", "a", 80), b("j2", "b", 60), b("j2", "c", 40),
      b("j3", "a", 50), b("j3", "b", 70), b("j3", "c", 65),
    ];
    const report = panelIntegrity(ballots);
    expect(report.lockstep).toHaveLength(1);
    expect(report.lockstep[0]).toMatchObject({ judgeA: "j1", judgeB: "j2", shared: 3, identical: 3, meanGap: 0 });
  });

  it("flags a ballot far from the rest of the panel on the same project", () => {
    const ballots: Ballot[] = [];
    for (const [j, bias] of [["j1", 0], ["j2", 5], ["j3", -5], ["j4", 2]] as const) {
      ballots.push(b(j, "a", 70 + bias), b(j, "b", 50 + bias), b(j, "c", 60 + bias), b(j, "d", 40 + bias));
    }
    ballots.find((x) => x.judgeId === "j4" && x.submissionId === "d")!.total = 95;
    const report = panelIntegrity(ballots);
    expect(report.outliers[0]).toMatchObject({ judgeId: "j4", submissionId: "d" });
    expect(report.outliers[0]!.deviation).toBeGreaterThan(2);
  });

  it("reports flat judges and stays quiet on an ordinary panel", () => {
    const ballots = [
      b("flat", "a", 70), b("flat", "b", 70), b("flat", "c", 70),
      b("j1", "a", 90), b("j1", "b", 50), b("j1", "c", 65),
      b("j2", "a", 55), b("j2", "b", 85), b("j2", "c", 60),
    ];
    const report = panelIntegrity(ballots);
    expect(report.flat).toEqual(["flat"]);
    expect(report.lockstep.filter((p) => p.judgeA === "j1" && p.judgeB === "j2")).toHaveLength(0);
  });
});
