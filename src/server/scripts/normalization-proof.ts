import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_MEAN_PRIOR,
  DEFAULT_VARIANCE_PRIOR,
  normalize,
  type Ballot,
  type NormalizationMethod,
  type NormalizeOptions,
} from "../src/algorithms/normalization.js";

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

const UNSHRUNK: NormalizeOptions = { meanPrior: 0, variancePrior: 0 };

function scoresBy(panel: Panel, method: NormalizationMethod, options?: NormalizeOptions): number[] {
  const result = normalize(panel.ballots, ids, method, options);
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
  meanSpearman: Record<NormalizationMethod | "ZSCORE_UNSHRUNK", number>;
  winsOverRaw: Record<"ZSCORE" | "RANK_AVERAGE", number>;
  ci95: { ZSCORE: [number, number]; RANK_AVERAGE: [number, number] };
  judgeMeanSpreadBefore: number;
}

/** Runs many seeded panels and compares each method's agreement with the true order. */
export function runProof(trials = 500): ProofSummary {
  const rho: Record<NormalizationMethod | "ZSCORE_UNSHRUNK", number[]> = {
    RAW: [],
    ZSCORE: [],
    ZSCORE_UNSHRUNK: [],
    RANK_AVERAGE: [],
  };
  const beforeSpread: number[] = [];

  for (let t = 0; t < trials; t += 1) {
    const panel = simulatePanel(1000 + t);
    for (const method of ["RAW", "ZSCORE", "RANK_AVERAGE"] as const) {
      rho[method].push(spearman(scoresBy(panel, method), panel.truth));
    }
    rho.ZSCORE_UNSHRUNK.push(spearman(scoresBy(panel, "ZSCORE", UNSHRUNK), panel.truth));

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
    meanSpearman: {
      RAW: mean(rho.RAW),
      ZSCORE: mean(rho.ZSCORE),
      ZSCORE_UNSHRUNK: mean(rho.ZSCORE_UNSHRUNK),
      RANK_AVERAGE: mean(rho.RANK_AVERAGE),
    },
    winsOverRaw: {
      ZSCORE: diffs("ZSCORE").filter((d) => d > 0).length / trials,
      RANK_AVERAGE: diffs("RANK_AVERAGE").filter((d) => d > 0).length / trials,
    },
    ci95: { ZSCORE: ci(diffs("ZSCORE")), RANK_AVERAGE: ci(diffs("RANK_AVERAGE")) },
    judgeMeanSpreadBefore: mean(beforeSpread),
  };
}

interface FixtureFile {
  teams: Array<{ id: string }>;
  projects: Array<{ id: string; team: string; title: string; submitted_at: string }>;
  scores: Array<{ judge: string; project: string; criteria: Record<string, number> }>;
}

/**
 * The organisers' fixtures.json as ballots: one submission per team (the earliest), criteria
 * weighted evenly, 1-5 mapped onto 0-100 the way the app's rubric does it.
 */
export function fixtureBallots(path = fileURLToPath(new URL("../../../fixtures.json", import.meta.url))) {
  const fx = JSON.parse(readFileSync(path, "utf8")) as FixtureFile;
  const firstByTeam = new Map<string, string>();
  for (const p of [...fx.projects].sort((a, b) => a.submitted_at.localeCompare(b.submitted_at))) {
    if (!firstByTeam.has(p.team)) firstByTeam.set(p.team, p.id);
  }
  const kept = new Set(firstByTeam.values());
  const seen = new Set<string>();
  const ballots: Ballot[] = [];
  for (const sc of fx.scores) {
    const key = `${sc.judge}/${sc.project}`;
    if (!kept.has(sc.project) || seen.has(key)) continue;
    seen.add(key);
    const values = Object.values(sc.criteria);
    const total = (values.reduce((a, v) => a + (v - 1) / 4, 0) / values.length) * 100;
    ballots.push({ judgeId: sc.judge, submissionId: sc.project, total: Math.round(total * 100) / 100 });
  }
  return { ballots, projectIds: [...kept].sort(), titles: new Map(fx.projects.map((p) => [p.id, p.title])) };
}

/**
 * Split-half reliability on the fixture, where no true order exists: each project's ballots are
 * split at random into two halves, both halves are ranked, and a method that measures projects
 * rather than panel luck makes the two halves agree more.
 */
export function fixtureSplitHalf(splits = 400) {
  const { ballots } = fixtureBallots();
  const variants: Array<[string, NormalizationMethod, NormalizeOptions | undefined]> = [
    ["RAW", "RAW", undefined],
    ["ZSCORE", "ZSCORE", undefined],
    ["ZSCORE_UNSHRUNK", "ZSCORE", UNSHRUNK],
    ["RANK_AVERAGE", "RANK_AVERAGE", undefined],
  ];
  const agreement = new Map<string, number[]>(variants.map(([name]) => [name, []]));
  const bySubmission = new Map<string, Ballot[]>();
  for (const b of ballots) bySubmission.set(b.submissionId, [...(bySubmission.get(b.submissionId) ?? []), b]);
  const splittable = [...bySubmission.entries()].filter(([, bs]) => bs.length >= 2);

  for (let t = 0; t < splits; t += 1) {
    const rand = prng(7000 + t);
    const a: Ballot[] = [];
    const b: Ballot[] = [];
    for (const [, bs] of splittable) {
      const shuffled = [...bs].sort(() => rand() - 0.5);
      const half = Math.floor(shuffled.length / 2) || 1;
      a.push(...shuffled.slice(0, half));
      b.push(...shuffled.slice(half));
    }
    const pids = splittable.map(([id]) => id);
    for (const [name, method, options] of variants) {
      const score = (half: Ballot[]) => {
        const r = normalize(half, pids, method, options);
        const m = new Map(r.results.map((x) => [x.submissionId, x.normalizedValue]));
        return pids.map((id) => m.get(id) ?? 0);
      };
      agreement.get(name)!.push(spearman(score(a), score(b)));
    }
  }
  const out = Object.fromEntries([...agreement.entries()].map(([k, v]) => [k, mean(v)])) as Record<string, number>;
  return { splits, projects: splittable.length, ballots: ballots.length, agreement: out };
}

/** Share of variance explained by a grouping (eta squared). */
function etaSquared(values: Array<{ group: string; value: number }>): number {
  const m = mean(values.map((v) => v.value));
  const total = values.reduce((s, v) => s + (v.value - m) ** 2, 0);
  const groups = new Map<string, number[]>();
  for (const v of values) groups.set(v.group, [...(groups.get(v.group) ?? []), v.value]);
  let between = 0;
  for (const g of groups.values()) between += g.length * (mean(g) - m) ** 2;
  return total === 0 ? 0 : between / total;
}

/** What normalization does to the organisers' fixtures.json, where there is no true order to compare against. */
export function fixtureEvidence() {
  const { ballots, projectIds, titles } = fixtureBallots();
  const explained = (method: NormalizationMethod, options?: NormalizeOptions) => {
    const r = normalize(ballots, projectIds, method, options);
    const rows = r.results.flatMap((row) =>
      row.contributions.map((c) => ({ judge: c.judgeId, project: row.submissionId, value: c.normalized })),
    );
    return {
      judge: etaSquared(rows.map((x) => ({ group: x.judge, value: x.value }))),
      project: etaSquared(rows.map((x) => ({ group: x.project, value: x.value }))),
    };
  };
  const shrunk = normalize(ballots, projectIds, "ZSCORE");
  const unshrunk = normalize(ballots, projectIds, "ZSCORE", UNSHRUNK);
  const movers = (r: ReturnType<typeof normalize>) =>
    [...r.results]
      .sort((a, b) => Math.abs(b.rankDelta) - Math.abs(a.rankDelta))
      .slice(0, 5)
      .map((row) => ({ title: titles.get(row.submissionId) ?? row.submissionId, raw: row.rawRank, norm: row.normalizedRank, low: row.lowSampleBallots }));
  const judges = new Set(ballots.map((b) => b.judgeId)).size;
  return {
    ballots: ballots.length,
    projects: projectIds.length,
    judges,
    flat: shrunk.judgeStats.filter((j) => j.degenerate).map((j) => `${j.judgeId} (${j.n} ballots at ${j.mean})`),
    lowSample: shrunk.judgeStats.filter((j) => j.lowSample).length,
    explained: {
      RAW: explained("RAW"),
      ZSCORE: explained("ZSCORE"),
      ZSCORE_UNSHRUNK: explained("ZSCORE", UNSHRUNK),
      RANK_AVERAGE: explained("RANK_AVERAGE"),
    },
    projectChance: (projectIds.length - 1) / (ballots.length - 1),
    splitHalf: fixtureSplitHalf(),
    movers: { shrunk: movers(shrunk), unshrunk: movers(unshrunk) },
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
    `| Per-judge z-score, shrunk (default) | ${f(s.meanSpearman.ZSCORE)} | ${(s.winsOverRaw.ZSCORE * 100).toFixed(0)}% of events | +${f(s.ci95.ZSCORE[0])} to +${f(s.ci95.ZSCORE[1])} |`,
  );
  lines.push(`| Per-judge z-score without shrinkage | ${f(s.meanSpearman.ZSCORE_UNSHRUNK)} | n/a | n/a |`);
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
  const fx = fixtureEvidence();
  const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
  lines.push("## On the fixture data", "");
  lines.push(
    `The organisers' \`fixtures.json\` as imported: ${fx.ballots} ballots from ${fx.judges} judges on ${fx.projects} projects. It has no true order, so the question it can answer is different: how much of a ballot is the judge, and how much is the project?`,
    "",
    `- Flat judge detected: ${fx.flat.join(", ") || "none"}. Their ballots contribute 0.`,
    `- ${fx.lowSample} of ${fx.judges} judges cast fewer than 3 ballots, so their scale is mostly the panel's prior.`,
    "",
    "| Method | Variance explained by which judge | Variance explained by which project |",
    "| --- | ---: | ---: |",
    `| Raw weighted total | ${pct(fx.explained.RAW.judge)} | ${pct(fx.explained.RAW.project)} |`,
    `| Per-judge z-score, shrunk (default) | ${pct(fx.explained.ZSCORE.judge)} | ${pct(fx.explained.ZSCORE.project)} |`,
    `| Per-judge z-score without shrinkage | ${pct(fx.explained.ZSCORE_UNSHRUNK.judge)} | ${pct(fx.explained.ZSCORE_UNSHRUNK.project)} |`,
    `| Rank average | ${pct(fx.explained.RANK_AVERAGE.judge)} | ${pct(fx.explained.RANK_AVERAGE.project)} |`,
    "",
    `In the raw totals, which judge you drew explains ${pct(fx.explained.RAW.judge)} of the variance. Normalization removes almost all of it; the shrunk z-score keeps a little on purpose, because with two ballots a judge's mean is as much their projects as their severity.`,
    "",
    `The honest caveat: the variance explained by project is at the level chance alone gives with ${fx.projects} groups over ${fx.ballots} ballots (${pct(fx.projectChance)}). A split-half test agrees: splitting each project's ballots at random into two halves and ranking each half, the halves correlate at ${fx.splitHalf.agreement.RAW!.toFixed(3)} raw and ${fx.splitHalf.agreement.ZSCORE!.toFixed(3)} normalized over ${fx.splitHalf.splits} splits. The fixture's scores carry judge effects but almost no project signal, so no method can recover an order from them, and the simulation above is where recovery is measured.`,
    "",
    "Largest rank movements on the fixture:",
    "",
    "| Estimator | Project (raw rank to normalized rank, thin-judge ballots) |",
    "| --- | --- |",
    `| Shrunk (default) | ${fx.movers.shrunk.map((m) => `${m.title} ${m.raw} to ${m.norm} (${m.low})`).join("; ")} |`,
    `| Unshrunk | ${fx.movers.unshrunk.map((m) => `${m.title} ${m.raw} to ${m.norm} (${m.low})`).join("; ")} |`,
    "",
    "Without shrinkage, projects read by one- and two-ballot judges make the largest jumps, because those judges are standardized against themselves. Shrinkage takes most of that out.",
    "",
  );
  lines.push("## Why it works, and where it does not", "");
  lines.push(
    "- A judge's score is `bias + scale * quality + noise`. Standardizing per judge subtracts the bias and divides out the scale, so two judges who agree on order but not on scale become interchangeable.",
    "- A judge who scores everything the same carries no ordering information. The z-score gives that judge zero rather than a spurious high or low, so a flat ballot set never lifts or sinks a project.",
    `- With few ballots per judge the mean and spread are noisy. Each judge's mean is shrunk toward the panel mean with a prior of ${DEFAULT_MEAN_PRIOR} ballot and their variance toward the pooled within-judge variance with a prior of ${DEFAULT_VARIANCE_PRIOR}, so a judge with one or two ballots is read mostly on the panel's scale instead of being standardized against themselves. The table shows the gain over the unshrunk estimator.`,
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
