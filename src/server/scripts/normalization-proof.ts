import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { normalize, type Ballot, type NormalizationMethod } from "../src/algorithms/normalization.js";

/**
 * Normalization proof: does per-judge standardization recover the true order of
 * projects better than the raw mean, when judges differ in severity and spread and
 * each judge only sees part of the field?
 *
 * The experiment is deterministic (seeded), so anyone can rerun it and get the same
 * numbers. Ground truth is a latent quality per project that we choose; judges observe
 * it through their own bias, scale and noise. That is the only setting in which "which
 * ranking is closer to the truth" has an answer, which is why the proof is simulated.
 *
 *   npm run proof            prints the report and writes docs/normalization-proof.md
 */

export const PROJECTS = 40;
export const JUDGES = 30;
export const REVIEWS_PER_PROJECT = 3;

/** mulberry32: a tiny seeded PRNG so every run is identical. */
function prng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(rand: () => number): number {
  const u = Math.max(rand(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
}

const clamp = (n: number) => Math.min(100, Math.max(0, n));

interface Panel {
  ballots: Ballot[];
  truth: number[];
  judgeBias: number[];
  judgeScale: number[];
}

/**
 * One event. Judges differ in severity (mean 45 to 85) and in spread (scale 4 to 16), and one
 * judge in ten gives every project the same score. Each project is read by three judges chosen
 * at random, so panel luck is real.
 */
export function simulatePanel(seed: number): Panel {
  const rand = prng(seed);
  const truth = Array.from({ length: PROJECTS }, () => gaussian(rand));
  const judgeBias = Array.from({ length: JUDGES }, () => 45 + rand() * 40);
  const judgeScale = Array.from({ length: JUDGES }, () => 4 + rand() * 12);
  const flat = new Set(Array.from({ length: JUDGES }, (_, j) => j).filter((_, j) => j % 10 === 9));

  const ballots: Ballot[] = [];
  for (let p = 0; p < PROJECTS; p += 1) {
    const chosen = new Set<number>();
    while (chosen.size < REVIEWS_PER_PROJECT) chosen.add(Math.floor(rand() * JUDGES));
    for (const j of chosen) {
      const noise = gaussian(rand) * 0.45;
      const total = flat.has(j)
        ? judgeBias[j]!
        : clamp(judgeBias[j]! + judgeScale[j]! * (truth[p]! + noise));
      ballots.push({ judgeId: `judge-${j}`, submissionId: `p-${p}`, total: Math.round(total * 100) / 100 });
    }
  }
  return { ballots, truth, judgeBias, judgeScale };
}

const ids = Array.from({ length: PROJECTS }, (_, p) => `p-${p}`);

/** Spearman correlation between two rankings, both given as one score per project. */
function spearman(a: number[], b: number[]): number {
  const rank = (xs: number[]) => {
    const order = xs.map((v, i) => ({ v, i })).sort((x, y) => x.v - y.v);
    const out = new Array<number>(xs.length);
    order.forEach((o, r) => {
      out[o.i] = r;
    });
    return out;
  };
  const ra = rank(a);
  const rb = rank(b);
  const n = a.length;
  const d2 = ra.reduce((s, r, i) => s + (r - rb[i]!) ** 2, 0);
  return 1 - (6 * d2) / (n * (n * n - 1));
}

function scoresBy(panel: Panel, method: NormalizationMethod): number[] {
  const result = normalize(panel.ballots, ids, method);
  const byId = new Map(result.results.map((r) => [r.submissionId, r]));
  return ids.map((id) => byId.get(id)?.normalizedValue ?? Number.NEGATIVE_INFINITY);
}

const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
const sd = (xs: number[]) => {
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / xs.length);
};

export interface ProofSummary {
  trials: number;
  meanSpearman: Record<NormalizationMethod, number>;
  winsOverRaw: Record<"ZSCORE" | "RANK_AVERAGE", number>;
  ci95: { ZSCORE: [number, number]; RANK_AVERAGE: [number, number] };
  judgeMeanSpreadBefore: number;
}

/** Runs many seeded panels and compares each method's agreement with the true order. */
export function runProof(trials = 500): ProofSummary {
  const rho: Record<NormalizationMethod, number[]> = { RAW: [], ZSCORE: [], RANK_AVERAGE: [] };
  const beforeSpread: number[] = [];

  for (let t = 0; t < trials; t += 1) {
    const panel = simulatePanel(1000 + t);
    for (const method of ["RAW", "ZSCORE", "RANK_AVERAGE"] as const) {
      rho[method].push(spearman(scoresBy(panel, method), panel.truth));
    }

    // Between-judge spread of mean scores (the severity problem), before and after standardizing.
    const raw = normalize(panel.ballots, ids, "RAW");
    beforeSpread.push(sd(raw.judgeStats.filter((s) => !s.degenerate).map((s) => s.mean)));
  }

  const diffs = (m: "ZSCORE" | "RANK_AVERAGE") => rho[m].map((v, i) => v - rho.RAW[i]!);
  const ci = (xs: number[]): [number, number] => {
    const m = mean(xs);
    const half = 1.96 * (sd(xs) / Math.sqrt(xs.length));
    return [m - half, m + half];
  };
  return {
    trials,
    meanSpearman: { RAW: mean(rho.RAW), ZSCORE: mean(rho.ZSCORE), RANK_AVERAGE: mean(rho.RANK_AVERAGE) },
    winsOverRaw: {
      ZSCORE: diffs("ZSCORE").filter((d) => d > 0).length / trials,
      RANK_AVERAGE: diffs("RANK_AVERAGE").filter((d) => d > 0).length / trials,
    },
    ci95: { ZSCORE: ci(diffs("ZSCORE")), RANK_AVERAGE: ci(diffs("RANK_AVERAGE")) },
    judgeMeanSpreadBefore: mean(beforeSpread),
  };
}

/** One worked panel: raw versus normalized rank for every project, largest movers first. */
export function workedExample(seed = 1000) {
  const panel = simulatePanel(seed);
  const result = normalize(panel.ballots, ids, "ZSCORE");
  const truthRank = new Map(
    ids
      .map((id, p) => ({ id, q: panel.truth[p]! }))
      .sort((a, b) => b.q - a.q)
      .map((x, i) => [x.id, i + 1] as const),
  );
  return result.results
    .map((r) => ({
      project: r.submissionId,
      rawMean: r.rawMean,
      rawRank: r.rawRank,
      zRank: r.normalizedRank,
      moved: r.rankDelta,
      trueRank: truthRank.get(r.submissionId)!,
    }))
    .sort((a, b) => Math.abs(b.moved) - Math.abs(a.moved));
}

function report(): string {
  const s = runProof();
  const example = workedExample();
  const f = (n: number, d = 3) => n.toFixed(d);
  const lines: string[] = [];
  lines.push("# Normalization proof", "");
  lines.push(
    `Generated by \`npm run proof\` (seeded, so it reproduces exactly). ${PROJECTS} projects, ${JUDGES} judges, ${REVIEWS_PER_PROJECT} reviews per project, ${s.trials} simulated events.`,
    "",
    "Judges differ in severity (mean 45 to 85) and spread (4 to 16 points), one judge in ten scores every project identically, and each project is read by three randomly chosen judges. Each project has a latent true quality, so we can measure which method gets closer to the true order.",
    "",
  );
  lines.push("## Result", "");
  lines.push("| Method | Mean Spearman with the true order | Beats raw in | Mean gain over raw (95% CI) |", "| --- | ---: | ---: | --- |");
  lines.push(`| Raw mean | ${f(s.meanSpearman.RAW)} | n/a | n/a |`);
  lines.push(
    `| Per-judge z-score (default) | ${f(s.meanSpearman.ZSCORE)} | ${(s.winsOverRaw.ZSCORE * 100).toFixed(0)}% of events | +${f(s.ci95.ZSCORE[0])} to +${f(s.ci95.ZSCORE[1])} |`,
  );
  lines.push(
    `| Rank average | ${f(s.meanSpearman.RANK_AVERAGE)} | ${(s.winsOverRaw.RANK_AVERAGE * 100).toFixed(0)}% of events | +${f(s.ci95.RANK_AVERAGE[0])} to +${f(s.ci95.RANK_AVERAGE[1])} |`,
  );
  lines.push("");
  lines.push(
    `Judges' mean scores spread with a standard deviation of **${f(s.judgeMeanSpreadBefore, 2)}** points, which is the severity problem. Standardizing sets every judge's mean to zero by construction, so that number alone proves nothing: the table above is the evidence, because it measures agreement with the true order.`,
    "",
  );
  lines.push("## One event, project by project", "");
  lines.push("The ten largest ranking movements in seed 1000. `moved` is positive when normalization lifted the project.", "");
  lines.push("| Project | Raw mean | Raw rank | Normalized rank | Moved | True rank |", "| --- | ---: | ---: | ---: | ---: | ---: |");
  for (const row of example.slice(0, 10)) {
    lines.push(`| ${row.project} | ${f(row.rawMean, 1)} | ${row.rawRank} | ${row.zRank} | ${row.moved > 0 ? "+" : ""}${row.moved} | ${row.trueRank} |`);
  }
  lines.push("");
  lines.push("## Why it works, and where it does not", "");
  lines.push(
    "- A judge's score is `bias + scale * quality + noise`. Standardizing per judge subtracts the bias and divides out the scale, so two judges who agree on order but not on scale become interchangeable.",
    "- A judge who scores everything the same carries no ordering information. The z-score gives that judge zero rather than a spurious high or low, so a flat ballot set never lifts or sinks a project.",
    "- The method needs each judge to read several projects. With very few ballots per judge the mean and spread are noisy, which is why the preview shows every method side by side and flags projects the methods disagree on.",
    "- It cannot rescue a judge who is noisy rather than biased, and it assumes judges are not colluding. See [SECURITY.md](SECURITY.md) for the threat model.",
    "",
    "The maths is in [JUDGING.md](../JUDGING.md). The assertions behind these numbers run in CI: `tests/unit/normalization-proof.test.ts`.",
    "",
  );
  return lines.join("\n");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const out = report();
  writeFileSync(fileURLToPath(new URL("../../../docs/normalization-proof.md", import.meta.url)), out);
  console.log(out);
}
