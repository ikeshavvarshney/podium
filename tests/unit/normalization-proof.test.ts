import { describe, expect, it } from "vitest";
import { runProof, simulatePanel, workedExample } from "../../src/server/scripts/normalization-proof.js";

describe("normalization proof", () => {
  it("reproduces: the same seed gives the same panel", () => {
    expect(simulatePanel(7).ballots).toEqual(simulatePanel(7).ballots);
  });

  it("recovers the true order better than the raw mean across simulated events", () => {
    const s = runProof(150);
    expect(s.meanSpearman.ZSCORE).toBeGreaterThan(s.meanSpearman.RAW + 0.05);
    expect(s.meanSpearman.RANK_AVERAGE).toBeGreaterThan(s.meanSpearman.RAW + 0.03);
    // The gain is not a fluke of a few events: the whole confidence interval sits above zero.
    expect(s.ci95.ZSCORE[0]).toBeGreaterThan(0);
    expect(s.winsOverRaw.ZSCORE).toBeGreaterThan(0.8);
  });

  it("moves projects a raw mean misplaces", () => {
    const rows = workedExample();
    expect(Math.abs(rows[0]!.moved)).toBeGreaterThanOrEqual(10);
  });
});
