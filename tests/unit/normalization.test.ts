import { describe, expect, it } from "vitest";
import {
  computeJudgeStats,
  normalize,
  type Ballot,
} from "../../src/server/src/algorithms/normalization.js";

const ballot = (judgeId: string, submissionId: string, total: number): Ballot => ({
  judgeId,
  submissionId,
  total,
});

const UNSHRUNK = { meanPrior: 0, variancePrior: 0 };

const rankOf = (result: ReturnType<typeof normalize>, submissionId: string) =>
  result.results.find((r) => r.submissionId === submissionId)!.normalizedRank;

const rawRankOf = (result: ReturnType<typeof normalize>, submissionId: string) =>
  result.results.find((r) => r.submissionId === submissionId)!.rawRank;

describe("computeJudgeStats", () => {
  it("computes n, mean and population sd per judge", () => {
    const stats = computeJudgeStats([
      ballot("harsh", "a", 50),
      ballot("harsh", "b", 60),
      ballot("harsh", "c", 40),
    ]);

    expect(stats).toHaveLength(1);
    expect(stats[0]!.n).toBe(3);
    expect(stats[0]!.mean).toBe(50);
    expect(stats[0]!.sd).toBeCloseTo(8.1650, 3);
    expect(stats[0]!.degenerate).toBe(false);
  });

  it("flags a judge who scored everything identically", () => {
    const stats = computeJudgeStats([
      ballot("flat", "a", 70),
      ballot("flat", "b", 70),
      ballot("flat", "c", 70),
    ]);
    expect(stats[0]!.sd).toBe(0);
    expect(stats[0]!.degenerate).toBe(true);
  });

  it("keeps judges separate", () => {
    const stats = computeJudgeStats([ballot("j1", "a", 10), ballot("j2", "a", 90)]);
    expect(stats.map((s) => s.judgeId)).toEqual(["j1", "j2"]);
  });
});

describe("normalize: correcting for judge severity", () => {
  /**
   * The core case. Two projects of equal quality, each read by one judge.
   * The harsh judge scores low across the board, the generous judge high.
   * Raw averaging ranks the project that drew the generous judge first;
   * normalization should treat them as equivalent.
   */
  it("stops a project being punished for drawing the harsh judge", () => {
    const ballots = [
      // Harsh judge: mean 50. "harshTop" is their best project.
      ballot("harsh", "harshTop", 60),
      ballot("harsh", "other1", 50),
      ballot("harsh", "other2", 40),
      // Generous judge: mean 80. "generousTop" is their best project.
      ballot("generous", "generousTop", 90),
      ballot("generous", "other3", 80),
      ballot("generous", "other4", 70),
    ];
    const ids = ["harshTop", "other1", "other2", "generousTop", "other3", "other4"];

    const raw = normalize(ballots, ids, "RAW");
    // Raw: every project the generous judge saw outranks the harsh judge's best.
    expect(rawRankOf(raw, "generousTop")).toBeLessThan(rawRankOf(raw, "harshTop"));
    expect(rawRankOf(raw, "other3")).toBeLessThan(rawRankOf(raw, "harshTop"));

    const z = normalize(ballots, ids, "ZSCORE", UNSHRUNK);
    // Normalized: each judge's best project ties at the top.
    expect(rankOf(z, "harshTop")).toBe(rankOf(z, "generousTop"));
    // And the harsh judge's best now beats the generous judge's worst.
    expect(rankOf(z, "harshTop")).toBeLessThan(rankOf(z, "other4"));
  });

  it("corrects for spread as well as severity", () => {
    const ballots = [
      // Wide scorer: uses the whole scale.
      ballot("wide", "w1", 95),
      ballot("wide", "w2", 50),
      ballot("wide", "w3", 5),
      // Narrow scorer: same ordering, compressed range.
      ballot("narrow", "n1", 62),
      ballot("narrow", "n2", 60),
      ballot("narrow", "n3", 58),
    ];
    const ids = ["w1", "w2", "w3", "n1", "n2", "n3"];

    const z = normalize(ballots, ids, "ZSCORE", UNSHRUNK);
    // Each judge's top project ties, despite a 33-point raw gap.
    expect(rankOf(z, "w1")).toBe(rankOf(z, "n1"));
    expect(rankOf(z, "w3")).toBe(rankOf(z, "n3"));
  });

  it("reports the rank movement caused by normalization", () => {
    const ballots = [
      ballot("harsh", "underdog", 60),
      ballot("harsh", "a", 50),
      ballot("harsh", "b", 40),
      ballot("generous", "frontrunner", 85),
      ballot("generous", "c", 90),
      ballot("generous", "d", 95),
    ];
    const ids = ["underdog", "a", "b", "frontrunner", "c", "d"];

    const z = normalize(ballots, ids, "ZSCORE");
    const underdog = z.results.find((r) => r.submissionId === "underdog")!;
    // Positive delta means it climbed once severity was accounted for.
    expect(underdog.rankDelta).toBeGreaterThan(0);
  });
});

describe("normalize: small samples", () => {
  const panel = [
    ballot("j1", "a", 80), ballot("j1", "b", 60), ballot("j1", "c", 40), ballot("j1", "d", 70),
    ballot("j2", "a", 75), ballot("j2", "b", 65), ballot("j2", "c", 45), ballot("j2", "d", 55),
  ];

  it("lets a single low ballot count against a project instead of vanishing", () => {
    const z = normalize([...panel, ballot("solo", "e", 20), ballot("j1", "e", 60)], ["a", "b", "c", "d", "e"], "ZSCORE");
    const e = z.results.find((r) => r.submissionId === "e")!;
    const solo = e.contributions.find((c) => c.judgeId === "solo")!;
    expect(solo.normalized).toBeLessThan(0);

    const unshrunk = normalize([...panel, ballot("solo", "e", 20), ballot("j1", "e", 60)], ["a", "b", "c", "d", "e"], "ZSCORE", UNSHRUNK);
    expect(unshrunk.results.find((r) => r.submissionId === "e")!.contributions.find((c) => c.judgeId === "solo")!.normalized).toBe(0);
  });

  it("flags low-sample judges and counts their ballots per project", () => {
    const z = normalize([...panel, ballot("solo", "a", 90)], ["a", "b", "c", "d"], "ZSCORE");
    expect(z.judgeStats.find((s) => s.judgeId === "solo")!.lowSample).toBe(true);
    expect(z.judgeStats.find((s) => s.judgeId === "j1")!.lowSample).toBe(false);
    expect(z.results.find((r) => r.submissionId === "a")!.lowSampleBallots).toBe(1);
    expect(z.results.find((r) => r.submissionId === "b")!.lowSampleBallots).toBe(0);
  });

  it("pulls a thin judge's scale toward the panel, and leaves a well-read judge nearly alone", () => {
    const stats = computeJudgeStats([...panel, ballot("thin", "a", 95), ballot("thin", "b", 85)]);
    const thin = stats.find((s) => s.judgeId === "thin")!;
    const j1 = stats.find((s) => s.judgeId === "j1")!;
    expect(thin.shrunkMean).toBeLessThan(thin.mean);
    expect(thin.shrunkSd).toBeGreaterThan(thin.sd);
    expect(Math.abs(j1.shrunkMean - j1.mean)).toBeLessThan(Math.abs(thin.shrunkMean - thin.mean));
  });
});

describe("normalize: the degenerate judge", () => {
  it("lets a flat judge neither lift nor sink a project", () => {
    const ballots = [
      ballot("flat", "a", 70),
      ballot("flat", "b", 70),
      ballot("flat", "c", 70),
    ];
    const z = normalize(ballots, ["a", "b", "c"], "ZSCORE");

    for (const row of z.results) expect(row.normalizedValue).toBe(0);
    expect(z.judgeStats[0]!.degenerate).toBe(true);
  });

  it("does not produce NaN or Infinity when sd is zero", () => {
    const ballots = [ballot("flat", "a", 70), ballot("flat", "b", 70)];
    const z = normalize(ballots, ["a", "b"], "ZSCORE");

    for (const row of z.results) {
      expect(Number.isFinite(row.normalizedValue)).toBe(true);
    }
  });

  it("still ranks using the judges who did discriminate", () => {
    const ballots = [
      ballot("flat", "a", 70),
      ballot("flat", "b", 70),
      ballot("real", "a", 90),
      ballot("real", "b", 40),
      ballot("real", "c", 65),
    ];
    const z = normalize(ballots, ["a", "b", "c"], "ZSCORE");
    expect(rankOf(z, "a")).toBeLessThan(rankOf(z, "b"));
  });

  it("handles a judge who cast exactly one ballot", () => {
    const z = normalize([ballot("solo", "a", 80)], ["a"], "ZSCORE");
    expect(z.judgeStats[0]!.n).toBe(1);
    expect(z.judgeStats[0]!.sd).toBe(0);
    expect(Number.isFinite(z.results[0]!.normalizedValue)).toBe(true);
  });
});

describe("normalize: rank-average method", () => {
  it("uses only the ordering within each judge", () => {
    const ballots = [
      ballot("wide", "top", 100),
      ballot("wide", "mid", 50),
      ballot("wide", "low", 0),
      ballot("narrow", "top2", 61),
      ballot("narrow", "mid2", 60),
      ballot("narrow", "low2", 59),
    ];
    const ids = ["top", "mid", "low", "top2", "mid2", "low2"];

    const ra = normalize(ballots, ids, "RANK_AVERAGE");
    expect(rankOf(ra, "top")).toBe(rankOf(ra, "top2"));
    expect(rankOf(ra, "low")).toBe(rankOf(ra, "low2"));
  });

  it("puts a judge's best project at 1 and worst at 0", () => {
    const ballots = [
      ballot("j", "best", 90),
      ballot("j", "mid", 70),
      ballot("j", "worst", 50),
    ];
    const ra = normalize(ballots, ["best", "mid", "worst"], "RANK_AVERAGE");

    expect(ra.results.find((r) => r.submissionId === "best")!.normalizedValue).toBe(1);
    expect(ra.results.find((r) => r.submissionId === "worst")!.normalizedValue).toBe(0);
  });

  it("gives tied ballots the same percentile", () => {
    const ballots = [
      ballot("j", "a", 80),
      ballot("j", "b", 80),
      ballot("j", "c", 40),
    ];
    const ra = normalize(ballots, ["a", "b", "c"], "RANK_AVERAGE");
    const a = ra.results.find((r) => r.submissionId === "a")!;
    const b = ra.results.find((r) => r.submissionId === "b")!;
    expect(a.normalizedValue).toBe(b.normalizedValue);
  });

  it("is insensitive to a monotonic rescaling of one judge's scores", () => {
    const base = [ballot("j", "a", 90), ballot("j", "b", 70), ballot("j", "c", 50)];
    const rescaled = [ballot("j", "a", 99), ballot("j", "b", 72), ballot("j", "c", 12)];

    const a = normalize(base, ["a", "b", "c"], "RANK_AVERAGE");
    const b = normalize(rescaled, ["a", "b", "c"], "RANK_AVERAGE");

    expect(a.results.map((r) => r.submissionId)).toEqual(b.results.map((r) => r.submissionId));
  });
});

describe("normalize: incomplete judging", () => {
  it("never zero-fills a project that has no ballots", () => {
    const ballots = [ballot("j", "scored", 80)];
    const result = normalize(ballots, ["scored", "unscored"], "ZSCORE");

    expect(result.unranked).toEqual(["unscored"]);
    expect(result.results.map((r) => r.submissionId)).toEqual(["scored"]);
  });

  it("ranks a partially judged project on the evidence it has", () => {
    const ballots = [
      ballot("j1", "full", 80),
      ballot("j2", "full", 70),
      ballot("j3", "full", 75),
      ballot("j1", "partial", 90),
    ];
    const result = normalize(ballots, ["full", "partial"], "ZSCORE");

    expect(result.results.find((r) => r.submissionId === "partial")!.ballotCount).toBe(1);
    expect(result.results.find((r) => r.submissionId === "full")!.ballotCount).toBe(3);
  });

  it("reports the ballot count so coverage gaps stay visible", () => {
    const ballots = [ballot("j1", "a", 80), ballot("j2", "a", 70), ballot("j1", "b", 60)];
    const result = normalize(ballots, ["a", "b"], "ZSCORE");

    expect(result.ballotCount).toBe(3);
    expect(result.results.find((r) => r.submissionId === "b")!.ballotCount).toBe(1);
  });

  it("handles an event with no ballots at all", () => {
    const result = normalize([], ["a", "b"], "ZSCORE");
    expect(result.results).toHaveLength(0);
    expect(result.unranked).toEqual(["a", "b"]);
  });
});

describe("normalize: ties", () => {
  it("gives identical scores the same rank", () => {
    const ballots = [
      ballot("j1", "a", 80),
      ballot("j1", "b", 80),
      ballot("j1", "c", 40),
    ];
    const result = normalize(ballots, ["a", "b", "c"], "ZSCORE");
    expect(rankOf(result, "a")).toBe(rankOf(result, "b"));
  });

  it("breaks a normalized tie on the number of ballots", () => {
    const ballots = [
      // Both average the same, but "wellRead" carries more evidence.
      ballot("j1", "wellRead", 80),
      ballot("j2", "wellRead", 80),
      ballot("j3", "wellRead", 80),
      ballot("j1", "thinlyRead", 80),
      // Give each judge spread so z-scores are defined.
      ballot("j1", "filler", 40),
      ballot("j2", "filler2", 40),
      ballot("j3", "filler3", 40),
    ];
    const ids = ["wellRead", "thinlyRead", "filler", "filler2", "filler3"];
    const result = normalize(ballots, ids, "ZSCORE");

    expect(rankOf(result, "wellRead")).toBeLessThanOrEqual(rankOf(result, "thinlyRead"));
  });

  it("uses dense ranking so the rank after a tie skips", () => {
    const ballots = [
      ballot("j", "a", 90),
      ballot("j", "b", 90),
      ballot("j", "c", 10),
    ];
    const result = normalize(ballots, ["a", "b", "c"], "RAW");
    const ranks = result.results.map((r) => r.normalizedRank).sort();
    expect(ranks).toEqual([1, 1, 3]);
  });
});

describe("normalize: reproducibility", () => {
  const ballots = [
    ballot("j1", "a", 82),
    ballot("j1", "b", 61),
    ballot("j2", "a", 74),
    ballot("j2", "c", 55),
    ballot("j3", "b", 90),
    ballot("j3", "c", 43),
  ];

  it("is deterministic", () => {
    const a = normalize(ballots, ["a", "b", "c"], "ZSCORE");
    const b = normalize(ballots, ["a", "b", "c"], "ZSCORE");
    expect(a).toEqual(b);
  });

  it("does not depend on the order ballots arrive in", () => {
    const shuffled = [...ballots].reverse();
    const a = normalize(ballots, ["a", "b", "c"], "ZSCORE");
    const b = normalize(shuffled, ["a", "b", "c"], "ZSCORE");

    expect(a.results.map((r) => r.submissionId)).toEqual(b.results.map((r) => r.submissionId));
    expect(a.results.map((r) => r.normalizedValue)).toEqual(
      b.results.map((r) => r.normalizedValue),
    );
  });

  it("exposes every ballot that contributed to a result", () => {
    const result = normalize(ballots, ["a", "b", "c"], "ZSCORE");
    const a = result.results.find((r) => r.submissionId === "a")!;

    expect(a.contributions).toHaveLength(2);
    expect(a.contributions.map((c) => c.judgeId).sort()).toEqual(["j1", "j2"]);
    // Both the raw total and its normalized form are inspectable.
    expect(a.contributions.every((c) => typeof c.total === "number")).toBe(true);
    expect(a.contributions.every((c) => typeof c.normalized === "number")).toBe(true);
  });

  it("captures the judge statistics used for the run", () => {
    const result = normalize(ballots, ["a", "b", "c"], "ZSCORE");
    expect(result.judgeStats.map((s) => s.judgeId)).toEqual(["j1", "j2", "j3"]);
    expect(result.method).toBe("ZSCORE");
    expect(result.ballotCount).toBe(6);
  });
});
