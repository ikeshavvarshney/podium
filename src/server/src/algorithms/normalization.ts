/**
 * Cross-judge normalization. Pure functions over ballots; the method and its
 * limitations are documented in JUDGING.md.
 *
 * The problem: judges do not share a scale. Averaging raw totals measures which
 * judges a project drew as much as it measures the project.
 */

export interface Ballot {
  judgeId: string;
  submissionId: string;
  /** Weighted total on a 0-100 scale. */
  total: number;
}

export type NormalizationMethod = "RAW" | "ZSCORE" | "RANK_AVERAGE";

export interface JudgeStat {
  judgeId: string;
  n: number;
  mean: number;
  sd: number;
  /** True when the judge gave effectively identical scores throughout. */
  degenerate: boolean;
}

export interface SubmissionResult {
  submissionId: string;
  ballotCount: number;
  rawMean: number;
  normalizedValue: number;
  rawRank: number;
  normalizedRank: number;
  /** Positive means the submission moved up under normalization. */
  rankDelta: number;
  contributions: Array<{ judgeId: string; total: number; normalized: number }>;
}

export interface NormalizationResult {
  method: NormalizationMethod;
  judgeStats: JudgeStat[];
  results: SubmissionResult[];
  /** Submissions with no ballots at all. Never ranked, never zero-filled. */
  unranked: string[];
  ballotCount: number;
}

/** Below this, a judge's spread is treated as no spread at all. */
const SD_EPSILON = 0.01;

const round = (n: number, places = 4): number => {
  const factor = 10 ** places;
  return Math.round(n * factor) / factor;
};

export function computeJudgeStats(ballots: Ballot[]): JudgeStat[] {
  const byJudge = new Map<string, number[]>();
  for (const b of ballots) {
    if (!byJudge.has(b.judgeId)) byJudge.set(b.judgeId, []);
    byJudge.get(b.judgeId)!.push(b.total);
  }

  return [...byJudge.entries()]
    .map(([judgeId, totals]) => {
      const n = totals.length;
      const mean = totals.reduce((s, t) => s + t, 0) / n;
      // Population standard deviation: these are all the ballots the judge
      // cast, not a sample drawn from a larger set.
      const variance = totals.reduce((s, t) => s + (t - mean) ** 2, 0) / n;
      const sd = Math.sqrt(variance);
      return {
        judgeId,
        n,
        mean: round(mean),
        sd: round(sd),
        degenerate: sd <= SD_EPSILON,
      };
    })
    .sort((a, b) => a.judgeId.localeCompare(b.judgeId));
}

/**
 * Per-judge z-score. Corrects for severity (a low mean) and for spread (a judge
 * who only uses part of the scale).
 *
 * A judge with no spread contributes 0, which is neutral: a flat ballot set
 * carries no information about which project is better, so it should neither
 * lift nor sink anyone.
 */
function zScoreOf(total: number, stat: JudgeStat): number {
  if (stat.degenerate) return 0;
  return (total - stat.mean) / stat.sd;
}

/**
 * Within-judge percentile, using only the order a judge put projects in. Robust
 * to any monotonic quirk in how a judge uses the scale, at the cost of
 * discarding magnitude.
 */
function rankPercentileOf(ballot: Ballot, judgeBallots: Ballot[]): number {
  const n = judgeBallots.length;
  if (n <= 1) return 0.5;

  const better = judgeBallots.filter((b) => b.total > ballot.total).length;
  const equal = judgeBallots.filter((b) => b.total === ballot.total).length;
  // Ties share the midpoint of the band they occupy.
  const effectiveBetter = better + (equal - 1) / 2;
  return 1 - effectiveBetter / (n - 1);
}

/** Dense ranking: equal values share a rank, and the next value skips. */
function assignRanks<T>(items: T[], valueOf: (item: T) => number): Map<T, number> {
  const sorted = [...items].sort((a, b) => valueOf(b) - valueOf(a));
  const ranks = new Map<T, number>();

  let rank = 1;
  for (let i = 0; i < sorted.length; i += 1) {
    const item = sorted[i]!;
    if (i > 0 && valueOf(item) !== valueOf(sorted[i - 1]!)) rank = i + 1;
    ranks.set(item, rank);
  }
  return ranks;
}

export function normalize(
  ballots: Ballot[],
  submissionIds: string[],
  method: NormalizationMethod = "ZSCORE",
): NormalizationResult {
  const judgeStats = computeJudgeStats(ballots);
  const statById = new Map(judgeStats.map((s) => [s.judgeId, s]));

  const byJudge = new Map<string, Ballot[]>();
  for (const b of ballots) {
    if (!byJudge.has(b.judgeId)) byJudge.set(b.judgeId, []);
    byJudge.get(b.judgeId)!.push(b);
  }

  const bySubmission = new Map<string, Ballot[]>();
  for (const id of submissionIds) bySubmission.set(id, []);
  for (const b of ballots) {
    if (!bySubmission.has(b.submissionId)) bySubmission.set(b.submissionId, []);
    bySubmission.get(b.submissionId)!.push(b);
  }

  const unranked: string[] = [];
  const rows: SubmissionResult[] = [];

  for (const [submissionId, subBallots] of bySubmission) {
    if (subBallots.length === 0) {
      unranked.push(submissionId);
      continue;
    }

    const rawMean = subBallots.reduce((s, b) => s + b.total, 0) / subBallots.length;

    const contributions = subBallots.map((b) => {
      const stat = statById.get(b.judgeId)!;
      const normalized =
        method === "RAW"
          ? b.total
          : method === "ZSCORE"
            ? zScoreOf(b.total, stat)
            : rankPercentileOf(b, byJudge.get(b.judgeId)!);
      return { judgeId: b.judgeId, total: round(b.total, 2), normalized: round(normalized) };
    });

    const normalizedValue =
      contributions.reduce((s, c) => s + c.normalized, 0) / contributions.length;

    rows.push({
      submissionId,
      ballotCount: subBallots.length,
      rawMean: round(rawMean, 2),
      normalizedValue: round(normalizedValue),
      rawRank: 0,
      normalizedRank: 0,
      rankDelta: 0,
      contributions,
    });
  }

  // Rank on the score alone, so equal scores are reported as a genuine tie
  // rather than being separated by a hidden heuristic.
  const rawRanks = assignRanks(rows, (r) => r.rawMean);
  const normRanks = assignRanks(rows, (r) => r.normalizedValue);

  for (const row of rows) {
    row.rawRank = rawRanks.get(row)!;
    row.normalizedRank = normRanks.get(row)!;
    row.rankDelta = row.rawRank - row.normalizedRank;
  }

  // Presentation order only. Within a tied rank, more evidence comes first,
  // then the higher raw mean. The shared rank itself does not change.
  rows.sort(
    (a, b) =>
      a.normalizedRank - b.normalizedRank ||
      b.ballotCount - a.ballotCount ||
      b.rawMean - a.rawMean ||
      a.submissionId.localeCompare(b.submissionId),
  );

  return {
    method,
    judgeStats,
    results: rows,
    unranked: unranked.sort(),
    ballotCount: ballots.length,
  };
}

/** Display scale for a z-score, matching what the results screen shows. */
export function displayZ(z: number): number {
  return round(50 + 10 * z, 1);
}
