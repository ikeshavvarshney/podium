"use client";

import { useMemo, useState } from "react";
import { tone, type Tone } from "./tone";

/**
 * The hero visual, made playable. Three judges, each with their own habit, review
 * four projects. Toggle who reviewed what and switch between raw averages and
 * per-judge normalization to see why the ranking moves. The scores are
 * illustrative; the arithmetic is the same z-score correction the product uses:
 * z = (x - mean of that judge) / spread of that judge, shown as 50 + 10z.
 */

const PROJECTS = [
  { name: "Atlas", quality: 82 },
  { name: "Beacon", quality: 74 },
  { name: "Cinder", quality: 66 },
  { name: "Delta", quality: 58 },
] as const;

const JUDGES: Array<{ name: string; habit: string; offset: number; noise: number[]; k: Tone }> = [
  { name: "Judge Harsh", habit: "scores low", offset: -16, noise: [1, -2, 2, -1], k: "orange" },
  { name: "Judge Steady", habit: "scores true", offset: 0, noise: [-1, 2, -2, 1], k: "cyan" },
  { name: "Judge Kind", habit: "scores high", offset: 14, noise: [2, -1, 1, -2], k: "violet" },
];

type Matrix = boolean[][]; // [judge][project]

const PRESETS: Record<"skewed" | "balanced", Matrix> = {
  // Harsh judge reads the strong projects, the kind judge reads the weak ones.
  skewed: [
    [true, true, false, false],
    [false, true, true, true],
    [false, false, true, true],
  ],
  balanced: [
    [true, true, true, true],
    [true, true, true, true],
    [true, true, true, true],
  ],
};

const ROW_H = 46;

function scoreOf(j: number, p: number) {
  const v = PROJECTS[p]!.quality + JUDGES[j]!.offset + JUDGES[j]!.noise[p]!;
  return Math.max(0, Math.min(100, v));
}

interface Row {
  p: number;
  raw: number | null;
  norm: number | null;
  reviews: number;
}

function standings(m: Matrix): Row[] {
  // Per-judge mean and spread over the projects that judge actually reviewed.
  const stats = JUDGES.map((_, j) => {
    const xs = m[j]!.flatMap((on, p) => (on ? [scoreOf(j, p)] : []));
    const mean = xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
    const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (xs.length || 1));
    return { n: xs.length, mean, sd };
  });
  return PROJECTS.map((_, p) => {
    const raws: number[] = [];
    const zs: number[] = [];
    JUDGES.forEach((_, j) => {
      if (!m[j]![p]) return;
      const x = scoreOf(j, p);
      const s = stats[j]!;
      raws.push(x);
      // A judge with fewer than two reviews has no spread; they contribute a neutral 0.
      zs.push(s.n >= 2 && s.sd > 0 ? (x - s.mean) / s.sd : 0);
    });
    const avg = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
    return {
      p,
      raw: raws.length ? avg(raws) : null,
      norm: zs.length ? 50 + 10 * avg(zs) : null,
      reviews: raws.length,
    };
  });
}

function rankBy(rows: Row[], key: "raw" | "norm"): number[] {
  const order = rows
    .map((r) => r.p)
    .sort((a, b) => {
      const va = rows[a]![key];
      const vb = rows[b]![key];
      if (va === null && vb === null) return a - b;
      if (va === null) return 1;
      if (vb === null) return -1;
      return vb - va || a - b;
    });
  const rank: number[] = [];
  order.forEach((p, i) => (rank[p] = i));
  return rank;
}

const CARD = "home-lift rounded-[16px] border border-line bg-surface p-[16px]";
const CHIP = "rounded-[6px] px-2 py-[3px] font-mono text-label uppercase tracking-stamp";

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  stack = false,
}: {
  stack?: boolean;
  label: string;
  value: T;
  options: Array<{ id: T; text: string }>;
  onChange: (v: T) => void;
}) {
  return (
    <div role="group" aria-label={label} className={`inline-flex rounded-[10px] border border-line bg-elevated p-[3px] ${stack ? "lg:flex-col" : ""}`}>
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          aria-pressed={value === o.id}
          onClick={() => onChange(o.id)}
          className={`sweep min-h-[36px] rounded-[7px] px-3 text-small font-medium transition-[background-color,color,box-shadow] duration-300 [transition-timing-function:cubic-bezier(0.22,1,0.36,1)] max-md:min-h-[44px] ${
            value === o.id ? "bg-surface text-text" : "text-muted hover:text-text"
          }`}
          style={{ ["--sweep" as string]: "var(--sf)", ["--sweep-fg" as string]: "var(--tx)", ...(value === o.id ? { boxShadow: "var(--home-shadow)" } : {}) }}
        >
          {o.text}
        </button>
      ))}
    </div>
  );
}

export function RankLab() {
  const [matrix, setMatrix] = useState<Matrix>(PRESETS.skewed);
  const [mode, setMode] = useState<"raw" | "norm">("norm");
  const [tick, setTick] = useState(0);

  const rows = useMemo(() => standings(matrix), [matrix]);
  const rawRank = useMemo(() => rankBy(rows, "raw"), [rows]);
  const shownRank = mode === "raw" ? rawRank : rankBy(rows, "norm");
  const preset = JSON.stringify(matrix) === JSON.stringify(PRESETS.balanced)
    ? "balanced"
    : JSON.stringify(matrix) === JSON.stringify(PRESETS.skewed)
      ? "skewed"
      : "custom";

  const leader = PROJECTS[shownRank.indexOf(0)]!.name;
  const trulyFirst = PROJECTS[0]!.name;

  function toggle(j: number, p: number) {
    setMatrix((m) => m.map((r, ji) => (ji === j ? r.map((v, pi) => (pi === p ? !v : v)) : r)));
    setTick((t) => t + 1);
  }

  const barFor = (r: Row) => {
    const v = mode === "raw" ? r.raw : r.norm;
    if (v === null) return 0;
    return mode === "raw" ? Math.max(0.04, v / 100) : Math.max(0.04, Math.min(1, (v - 30) / 40));
  };

  return (
    <figure className="m-0 min-w-0">
      <div
        className="home-dots relative overflow-hidden rounded-[24px] border border-line p-[clamp(14px,2.6vw,28px)]"
        style={{ backgroundColor: "var(--sf)", boxShadow: "var(--home-shadow-up)" }}
      >
        <div
          className="pointer-events-none absolute inset-0"
          aria-hidden="true"
          style={{
            background:
              "radial-gradient(360px 240px at 0% 0%, var(--k-blue-s), transparent 70%), radial-gradient(360px 240px at 100% 100%, var(--k-violet-s), transparent 70%), radial-gradient(240px 180px at 100% 0%, var(--k-cyan-s), transparent 72%)",
          }}
        />
        <div className="relative mx-auto max-w-[480px] lg:flex lg:max-w-none lg:items-stretch">
          {/* 1. Who reviewed what */}
          <div className={`${CARD} lg:min-w-0 lg:flex-1`} style={{ boxShadow: "var(--home-shadow)" }}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className={CHIP} style={{ background: "var(--k-blue-s)", color: "var(--k-blue-t)" }}>Who reviewed what</span>
              <Segmented
                label="Panel"
                value={preset === "custom" ? ("" as "skewed") : (preset as "skewed" | "balanced")}
                options={[
                  { id: "skewed", text: "Uneven" },
                  { id: "balanced", text: "Everyone reads all" },
                ]}
                onChange={(v) => {
                  setMatrix(PRESETS[v].map((r) => [...r]));
                  setTick((t) => t + 1);
                }}
              />
            </div>

            <div className="mt-3.5 grid grid-cols-[minmax(0,1.5fr)_repeat(4,minmax(0,1fr))] items-center gap-x-1.5 gap-y-1.5 max-[420px]:grid-cols-[minmax(0,1.05fr)_repeat(4,minmax(0,1fr))] max-[420px]:gap-x-1">
              <span aria-hidden="true" />
              {PROJECTS.map((pr) => (
                <span key={pr.name} className="truncate text-center font-mono text-label uppercase tracking-stamp text-muted">
                  {pr.name}
                </span>
              ))}
              {JUDGES.map((jd, j) => (
                <div key={jd.name} className="contents" style={tone(jd.k)}>
                  <span className="flex min-w-0 items-center gap-2 pr-1">
                    <i className="h-2 w-2 flex-none rounded-full" style={{ background: "var(--k)" }} aria-hidden="true" />
                    <span className="min-w-0 leading-[1.2]">
                      <span className="block truncate text-small font-medium">{jd.name.replace("Judge ", "")}</span>
                      <span className="block truncate font-mono text-label text-muted">{jd.habit}</span>
                    </span>
                  </span>
                  {PROJECTS.map((pr, p) => {
                    const on = matrix[j]![p]!;
                    return (
                      <button
                        key={pr.name}
                        type="button"
                        aria-pressed={on}
                        aria-label={`${jd.name} reviews ${pr.name}`}
                        onClick={() => toggle(j, p)}
                        className="sweep group relative grid h-10 place-items-center rounded-[9px] border transition-[background-color,border-color,transform] duration-300 [transition-timing-function:cubic-bezier(0.22,1,0.36,1)] hover:-translate-y-px active:scale-95 max-md:h-11"
                        style={{
                          background: on ? "var(--ks)" : "var(--sf)",
                          borderColor: on ? "var(--k)" : "var(--ln)",
                          ...tone(jd.k),
                          ["--sweep" as string]: "color-mix(in srgb, var(--k) 24%, transparent)",
                          ["--sweep-fg" as string]: "inherit",
                        }}
                      >
                        <span
                          className="font-mono text-meta transition-[opacity,transform] duration-300 [transition-timing-function:cubic-bezier(0.22,1,0.36,1)]"
                          style={{
                            color: on ? "var(--kt)" : "var(--mu)",
                            opacity: on ? 1 : 0.45,
                            transform: on ? "scale(1)" : "scale(0.86)",
                          }}
                        >
                          {on ? scoreOf(j, p) : "off"}
                        </span>
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
            <p className="m-0 mt-3 text-small leading-[1.5] text-muted">
              Click a cell to add or remove a review. Numbers are that judge&apos;s raw score.
            </p>
          </div>

          {/* 2. The correction */}
          <div className="relative mx-auto flex h-[82px] items-center justify-center lg:h-auto lg:w-[176px] lg:flex-none">
            <svg viewBox="0 0 176 12" className="absolute left-0 top-1/2 hidden h-3 w-full -translate-y-1/2 overflow-visible lg:block" aria-hidden="true">
              <path d="M0 6 H176" className="home-flow" fill="none" stroke="var(--k-violet)" strokeWidth="1.6" strokeLinecap="round" />
              <circle cx="0" cy="6" r="3.4" fill="var(--k-violet)" className="stage-travel-x" />
            </svg>
            <svg viewBox="0 0 12 82" className="absolute left-1/2 top-0 h-full w-3 -translate-x-1/2 overflow-visible lg:hidden" aria-hidden="true">
              <path d="M6 0 V82" className="home-flow" fill="none" stroke="var(--k-violet)" strokeWidth="1.6" strokeLinecap="round" />
              <circle cx="6" cy="0" r="3.4" fill="var(--k-violet)" className="stage-travel" />
            </svg>
            <div className="relative">
              <Segmented
                label="Scoring method"
                value={mode}
                options={[
                  { id: "raw", text: "Raw average" },
                  { id: "norm", text: "Normalized" },
                ]}
                stack
                onChange={(v) => {
                  setMode(v);
                  setTick((t) => t + 1);
                }}
              />
            </div>
          </div>

          {/* 3. Standings */}
          <div className={`${CARD} relative lg:min-w-0 lg:flex-1`} style={{ boxShadow: "var(--home-shadow)" }}>
            {tick > 0 ? <span key={tick} aria-hidden="true" className="rank-flash" /> : null}
            <div className="flex items-center justify-between gap-3">
              <span className={CHIP} style={{ background: "var(--k-green-s)", color: "var(--k-green-t)" }}>Standings</span>
              <span className="font-mono text-label text-muted">{mode === "raw" ? "mean of raw scores" : "mean of 50 + 10z"}</span>
            </div>
            <ol className="relative m-0 mt-2.5 list-none p-0" style={{ height: ROW_H * PROJECTS.length }}>
              {rows.map((r) => {
                const rank = shownRank[r.p]!;
                const moved = rawRank[r.p]! - rank;
                const value = mode === "raw" ? r.raw : r.norm;
                const k: Tone = r.p === 0 ? "blue" : "cyan";
                return (
                  <li
                    key={PROJECTS[r.p]!.name}
                    className="hero-row absolute left-0 right-0 top-0"
                    style={{ height: ROW_H, transform: `translateY(${rank * ROW_H}px)` }}
                  >
                    <div
                      className="relative flex h-[40px] items-center gap-3 overflow-hidden rounded-[9px] border px-3 transition-[border-color,background-color] duration-500"
                      style={{
                        ...tone(k),
                        background: r.p === 0 ? "var(--k-blue-s)" : "var(--sf)",
                        borderColor: r.p === 0 ? "var(--k-blue)" : "var(--ln)",
                      }}
                    >
                      <span
                        aria-hidden="true"
                        className="hero-bar absolute inset-y-0 left-0 w-full origin-left opacity-[0.16]"
                        style={{ background: "var(--k)", transform: `scaleX(${barFor(r)})` }}
                      />
                      <span className="relative w-3 font-mono text-meta text-muted">{rank + 1}</span>
                      <span className="relative min-w-0 flex-1 truncate text-ui font-medium">{PROJECTS[r.p]!.name}</span>
                      <span className="relative font-mono text-meta text-muted tabular-nums">
                        {value === null ? "no reviews" : mode === "raw" ? value.toFixed(0) : value.toFixed(1)}
                      </span>
                      <span
                        className="relative min-w-[40px] rounded-[5px] px-1.5 py-[2px] text-center font-mono text-label"
                        style={
                          mode === "raw" || moved === 0
                            ? { color: "var(--mu)" }
                            : moved > 0
                              ? { background: "var(--k-green-s)", color: "var(--k-green-t)" }
                              : { background: "var(--k-orange-s)", color: "var(--k-orange-t)" }
                        }
                      >
                        {mode === "raw" ? "raw" : moved === 0 ? "held" : moved > 0 ? `+${moved}` : String(moved)}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ol>
          </div>
        </div>
      </div>

      <figcaption className="mt-4 flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
        <p className="m-0 max-w-[46ch] text-small leading-[1.5] text-muted" role="status" aria-live="polite">
          {leader === trulyFirst
            ? `${leader} leads, which matches its actual quality.`
            : `${leader} leads, but ${trulyFirst} is the strongest project. Switch to Normalized, or let every judge read every project.`}
        </p>
        <span className="font-mono text-label text-muted">illustrative data</span>
      </figcaption>
    </figure>
  );
}
