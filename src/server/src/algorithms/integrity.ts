/**
 * Signals an organizer should look at before publishing. None of them rejects a ballot: each is
 * a reason to ask a question, and the organizer decides.
 */
import { normalize, type Ballot } from "./normalization.js";

export interface PairSignal {
  judgeA: string;
  judgeB: string;
  shared: number;
  /** Mean absolute gap between their totals on the projects both scored. */
  meanGap: number;
  /** Pearson correlation of their totals; null below four shared projects. */
  correlation: number | null;
  identical: number;
}

export interface OutlierBallot {
  judgeId: string;
  submissionId: string;
  /** This judge's standardized score minus the mean of the other judges' on the same project. */
  deviation: number;
}

export interface IntegrityReport {
  lockstep: PairSignal[];
  outliers: OutlierBallot[];
  flat: string[];
}

/** Pairs agree this closely only by coordination or by sharing a scale by accident. */
const LOCKSTEP_CORRELATION = 0.95;
const LOCKSTEP_MIN_SHARED = 3;
/** Two standard deviations away from the rest of the panel on the same project. */
const OUTLIER_DEVIATION = 2;

function pearson(xs: number[], ys: number[]): number | null {
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i += 1) {
    sxy += (xs[i]! - mx) * (ys[i]! - my);
    sxx += (xs[i]! - mx) ** 2;
    syy += (ys[i]! - my) ** 2;
  }
  return sxx === 0 || syy === 0 ? null : sxy / Math.sqrt(sxx * syy);
}

const round = (n: number) => Math.round(n * 1000) / 1000;

export function panelIntegrity(ballots: Ballot[]): IntegrityReport {
  const byJudge = new Map<string, Map<string, number>>();
  for (const b of ballots) {
    if (!byJudge.has(b.judgeId)) byJudge.set(b.judgeId, new Map());
    byJudge.get(b.judgeId)!.set(b.submissionId, b.total);
  }

  const judges = [...byJudge.keys()].sort();
  const lockstep: PairSignal[] = [];
  for (let i = 0; i < judges.length; i += 1) {
    for (let j = i + 1; j < judges.length; j += 1) {
      const a = byJudge.get(judges[i]!)!;
      const b = byJudge.get(judges[j]!)!;
      const shared = [...a.keys()].filter((id) => b.has(id));
      if (shared.length < LOCKSTEP_MIN_SHARED) continue;
      const xs = shared.map((id) => a.get(id)!);
      const ys = shared.map((id) => b.get(id)!);
      const identical = shared.filter((_, k) => xs[k] === ys[k]).length;
      const correlation = shared.length >= 4 ? pearson(xs, ys) : null;
      const signal: PairSignal = {
        judgeA: judges[i]!,
        judgeB: judges[j]!,
        shared: shared.length,
        meanGap: round(xs.reduce((s, x, k) => s + Math.abs(x - ys[k]!), 0) / shared.length),
        correlation: correlation === null ? null : round(correlation),
        identical,
      };
      if (identical === shared.length || (correlation !== null && correlation >= LOCKSTEP_CORRELATION)) {
        lockstep.push(signal);
      }
    }
  }

  const z = normalize(ballots, [...new Set(ballots.map((b) => b.submissionId))], "ZSCORE");
  const outliers: OutlierBallot[] = [];
  for (const row of z.results) {
    if (row.contributions.length < 3) continue;
    for (const c of row.contributions) {
      const others = row.contributions.filter((o) => o.judgeId !== c.judgeId);
      const rest = others.reduce((s, o) => s + o.normalized, 0) / others.length;
      const deviation = c.normalized - rest;
      if (Math.abs(deviation) >= OUTLIER_DEVIATION) {
        outliers.push({ judgeId: c.judgeId, submissionId: row.submissionId, deviation: round(deviation) });
      }
    }
  }
  outliers.sort((a, b) => Math.abs(b.deviation) - Math.abs(a.deviation));

  return {
    lockstep: lockstep.sort((a, b) => b.shared - a.shared),
    outliers,
    flat: z.judgeStats.filter((s) => s.degenerate).map((s) => s.judgeId),
  };
}
