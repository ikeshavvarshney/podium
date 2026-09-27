"use client";

import { useState } from "react";

const PANEL = "home-lift min-w-0 rounded-[18px] border border-line bg-surface p-[clamp(18px,3vw,28px)]";
const PANEL_SHADOW = { boxShadow: "var(--home-shadow)" };

/**
 * Two judges' score distributions. They differ in centre AND spread: the harsh judge scores low in a
 * tight band, the generous judge scores high across a wide one. The correction standardizes both, so
 * they land on one centre and one spread, and only the differences between projects remain.
 */
const BELL = "M-52,152 C-32,152 -28,54 0,54 C28,54 32,152 52,152";
const PEAK_Y = 54;
const BASE_Y = 152;

interface CurveState {
  x: number;
  sx: number;
  sy: number;
}

const RAW: { harsh: CurveState; kind: CurveState } = {
  harsh: { x: 128, sx: 0.6, sy: 1.1 },
  kind: { x: 292, sx: 1.28, sy: 0.64 },
};
const FIXED: CurveState = { x: 210, sx: 0.95, sy: 0.9 };

export function NormalizationCurves() {
  const [fixed, setFixed] = useState(false);
  const ticks = [0, 1, 2, 3, 4].map((i) => 16 + i * 97);
  const harsh = fixed ? FIXED : RAW.harsh;
  const kind = fixed ? FIXED : RAW.kind;
  const peakY = (c: CurveState) => BASE_Y - (BASE_Y - PEAK_Y) * c.sy;

  const curve = (c: CurveState, color: string, dashed?: boolean) => (
    <g style={{ transform: `translateX(${c.x}px)` }} className="curve-move">
      <g
        style={{ transform: `scale(${c.sx}, ${c.sy})`, transformOrigin: `0px ${BASE_Y}px` }}
        className="curve-move"
      >
        <path
          d={BELL}
          fill={color}
          fillOpacity={fixed ? 0.2 : 0.13}
          className="[transition:fill-opacity_1200ms_ease]"
          stroke={color}
          strokeWidth="2"
          strokeLinecap="round"
          strokeDasharray={dashed && fixed ? "5 5" : undefined}
          vectorEffect="non-scaling-stroke"
        />
        <line x1="0" y1={PEAK_Y} x2="0" y2={BASE_Y} stroke={color} strokeOpacity="0.5" strokeDasharray="2 4" vectorEffect="non-scaling-stroke" />
      </g>
      <circle cy={PEAK_Y} r="4" fill={color} className="curve-move" style={{ transform: `translateY(${peakY(c) - PEAK_Y}px)` }} />
    </g>
  );

  return (
    <div className={PANEL} style={PANEL_SHADOW}>
      <svg
        viewBox="0 0 420 196"
        className="block h-auto w-full overflow-visible"
        role="img"
        aria-label={
          fixed
            ? "After the correction both judges share one centre and one spread, drawn on top of each other"
            : "Two judge score distributions on a 1 to 5 scale: a harsh judge scoring low in a tight band and a generous judge scoring high across a wide band"
        }
      >
        {ticks.map((x, i) => (
          <g key={x}>
            <line x1={x} y1="36" x2={x} y2="152" stroke="var(--ln)" strokeOpacity={i === 2 ? 0 : 0.7} />
            <text x={x} y="172" textAnchor="middle" fill="var(--mu)" className="font-mono" style={{ fontSize: 10 }}>{i + 1}</text>
          </g>
        ))}
        <line x1="16" y1="152" x2="404" y2="152" stroke="var(--ln-strong)" strokeOpacity="0.5" />
        <line x1="210" y1="30" x2="210" y2="152" stroke="var(--tx)" strokeOpacity="0.55" strokeDasharray="3 5" />

        {curve(harsh, "var(--k-violet)")}
        {curve(kind, "var(--k-blue)", true)}

        <g className="[transition:opacity_350ms_ease]" style={{ opacity: fixed ? 0 : 1, transitionDelay: fixed ? "0ms" : "1000ms" }}>
          <text x={RAW.harsh.x} y="26" textAnchor="middle" fill="var(--tx)" className="font-mono" style={{ fontSize: 10, letterSpacing: "0.06em" }}>HARSH JUDGE</text>
          <text x={RAW.kind.x} y="26" textAnchor="middle" fill="var(--tx)" className="font-mono" style={{ fontSize: 10, letterSpacing: "0.06em" }}>GENEROUS JUDGE</text>
        </g>
        <text x="210" y="20" textAnchor="middle" fill="var(--tx)" className="font-mono [transition:opacity_600ms_ease]" style={{ fontSize: 10, letterSpacing: "0.06em", opacity: fixed ? 1 : 0, transitionDelay: fixed ? "1000ms" : "0ms" }}>SAME CENTRE, SAME SPREAD</text>
        <circle cx="210" cy="152" r="3.5" fill="var(--tx)" />
      </svg>

      <div className="mt-5 flex flex-wrap items-center justify-between gap-x-5 gap-y-3 border-t border-line pt-4">
        <div className="flex flex-wrap gap-x-4 gap-y-2 text-small text-muted">
          <span className="inline-flex items-center gap-2"><i className="h-[3px] w-4 rounded-sm" style={{ background: "var(--k-violet)" }} />harsh: low, tight</span>
          <span className="inline-flex items-center gap-2"><i className="h-[3px] w-4 rounded-sm" style={{ background: "var(--k-blue)" }} />generous: high, wide</span>
          <span className="inline-flex items-center gap-2"><i className="w-4 border-t border-dashed border-text" />event centre</span>
        </div>
        <button
          type="button"
          aria-pressed={fixed}
          onClick={() => setFixed((v) => !v)}
          className="hb !min-h-[44px] !px-4 !text-ui"
        >
          {fixed ? "Show raw scores" : "Apply the correction"}
        </button>
      </div>
      <p role="status" className="m-0 mt-3 text-small text-muted">
        {fixed
          ? "Both judges now share one centre and one spread, so only the differences between projects remain."
          : "The harsh judge scores low in a narrow band; the generous judge scores high across a wide one."}
      </p>
    </div>
  );
}

const SLOPES = [
  { y0: 26, y1: 60, name: "moved down one", dir: "down" },
  { y0: 60, y1: 26, name: "moved up one", dir: "up" },
  { y0: 94, y1: 128, name: "moved down one", dir: "down" },
  { y0: 128, y1: 94, name: "moved up one", dir: "up" },
  { y0: 162, y1: 162, name: "held rank", dir: "held" },
  { y0: 196, y1: 196, name: "held rank", dir: "held" },
] as const;

const DIR_COLOR = { up: "var(--k-green)", down: "var(--k-orange)", held: "var(--ln-strong)" } as const;
const DIR_TEXT = { up: "var(--k-green-t)", down: "var(--k-orange-t)", held: "var(--mu)" } as const;
const rankAt = (y: number) => Math.round((y - 26) / 34) + 1;

export function SlopeChart() {
  const [hot, setHot] = useState<number | null>(null);
  return (
    <div className={PANEL} style={PANEL_SHADOW}>
      <svg
        viewBox="0 0 340 222"
        className="block h-auto w-full"
        role="img"
        aria-label="Slope chart: six projects change rank between raw and normalized scoring. Two move up one place, two move down one place, two hold."
      >
        <text x="76" y="8" textAnchor="middle" fill="var(--mu)" className="font-mono" style={{ fontSize: 9.5, letterSpacing: "0.1em" }}>RAW</text>
        <text x="228" y="8" textAnchor="middle" fill="var(--mu)" className="font-mono" style={{ fontSize: 9.5, letterSpacing: "0.1em" }}>NORMALIZED</text>
        <line x1="76" y1="18" x2="76" y2="206" stroke="var(--ln)" />
        <line x1="228" y1="18" x2="228" y2="206" stroke="var(--ln)" />
        {SLOPES.map((l, i) => {
          const lit = hot === i;
          const dim = hot !== null && !lit;
          const color = DIR_COLOR[l.dir];
          const d = `M76,${l.y0} C152,${l.y0} 152,${l.y1} 228,${l.y1}`;
          return (
            <g key={i} onMouseEnter={() => setHot(i)} onMouseLeave={() => setHot(null)}>
              <path d={d} fill="none" stroke="transparent" strokeWidth="14" />
              <path
                d={d}
                fill="none"
                pathLength={1}
                stroke={color}
                strokeWidth={lit ? 3 : l.dir === "held" ? 1.5 : 2.2}
                strokeOpacity={dim ? 0.2 : l.dir === "held" ? 0.6 : 1}
                strokeLinecap="round"
                className="draw [transition:stroke-opacity_240ms,stroke-width_240ms]"
              />
              <text x="58" y={l.y0 + 3.5} textAnchor="end" fill="var(--mu)" className="font-mono" style={{ fontSize: 10 }} fillOpacity={dim ? 0.35 : 1}>{rankAt(l.y0)}</text>
              <text x="246" y={l.y1 + 3.5} fill="var(--tx)" className="font-mono" style={{ fontSize: 10 }} fillOpacity={dim ? 0.35 : 1}>{rankAt(l.y1)}</text>
              <text x="278" y={l.y1 + 3.5} fill={DIR_TEXT[l.dir]} className="font-mono" style={{ fontSize: 10, fontWeight: 500 }} fillOpacity={dim ? 0.35 : 1}>
                {l.dir === "up" ? "+1" : l.dir === "down" ? "-1" : "held"}
              </text>
              <circle cx="76" cy={l.y0} r={lit ? 5.5 : 4} fill="var(--sf)" stroke={color} strokeWidth="1.8" strokeOpacity={dim ? 0.25 : 1} className="pop" style={{ ["--d" as string]: `${300 + i * 90}ms` }} />
              <circle cx="228" cy={l.y1} r={lit ? 5.5 : 4} fill={l.dir === "held" ? "var(--sf)" : color} stroke={color} strokeWidth="1.8" strokeOpacity={dim ? 0.25 : 1} fillOpacity={dim ? 0.25 : 1} className="pop" style={{ ["--d" as string]: `${300 + i * 90}ms` }} />
            </g>
          );
        })}
      </svg>
      <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-line pt-4 text-small text-muted">
        <span className="inline-flex items-center gap-2"><i className="h-[3px] w-4 rounded-sm" style={{ background: DIR_COLOR.up }} />moved up</span>
        <span className="inline-flex items-center gap-2"><i className="h-[3px] w-4 rounded-sm" style={{ background: DIR_COLOR.down }} />moved down</span>
        <span className="inline-flex items-center gap-2"><i className="h-[3px] w-4 rounded-sm" style={{ background: DIR_COLOR.held }} />held</span>
      </div>
    </div>
  );
}

const JUDGES = [
  { y: 40, k: "blue" },
  { y: 76, k: "violet" },
  { y: 112, k: "cyan" },
  { y: 148, k: "green" },
  { y: 184, k: "orange" },
] as const;
const PROJ = [16, 40, 64, 92, 116, 130, 142, 168, 196];
const EDGES = [
  { j: 0, p: 2 },
  { j: 0, p: 4 },
  { j: 0, p: 5 },
  { j: 1, p: 1 },
  { j: 1, p: 7 },
  { j: 2, p: 3 },
  { j: 2, p: 8 },
  { j: 2, p: 5 },
  { j: 3, p: 6 },
  { j: 3, p: 0 },
  { j: 4, p: 7 },
  { j: 4, p: 5 },
];

/** Judges on the left, submissions on the right; each judge gets a colour so their reach can be traced. */
export function AssignmentDiagram() {
  const [hover, setHover] = useState<string | null>(null);
  const on = (id: string) => ({
    onMouseEnter: () => setHover(id),
    onMouseLeave: () => setHover(null),
    onClick: () => setHover((h) => (h === id ? null : id)),
  });

  const litEdge = (e: { j: number; p: number }) => hover === `j${e.j}` || hover === `p${e.p}`;
  return (
    <div className={`${PANEL} order-2`} style={PANEL_SHADOW} onMouseLeave={() => setHover(null)}>
      <svg
        viewBox="0 0 420 220"
        className="block h-auto w-full"
        role="img"
        aria-label="Five judges on the left, each in their own colour, connected to the submissions they review on the right. Every submission is reviewed by several judges."
      >
        {EDGES.map((e, k) => {
          const lit = litEdge(e);
          return (
            <path
              key={k}
              d={`M74,${JUDGES[e.j]!.y} C180,${JUDGES[e.j]!.y} 240,${PROJ[e.p]} 346,${PROJ[e.p]}`}
              fill="none"
              pathLength={1}
              className="draw [transition:stroke-opacity_240ms,stroke-width_240ms]"
              stroke={`var(--k-${JUDGES[e.j]!.k})`}
              strokeWidth={lit ? 2.6 : 1.4}
              strokeOpacity={lit ? 1 : hover ? 0.12 : 0.5}
              strokeLinecap="round"
            />
          );
        })}
        {[0, 3, 5, 8, 10].map((ei, n) => (
          <circle
            key={`t${ei}`}
            r="3.2"
            fill={`var(--k-${JUDGES[EDGES[ei]!.j]!.k})`}
            className="mark-dot"
            style={{
              offsetPath: `path("M74,${JUDGES[EDGES[ei]!.j]!.y} C180,${JUDGES[EDGES[ei]!.j]!.y} 240,${PROJ[EDGES[ei]!.p]} 346,${PROJ[EDGES[ei]!.p]}")`,
              ["--d" as string]: `${n * 0.9}s`,
            }}
          />
        ))}
        {PROJ.map((y, k) => {
          const id = `p${k}`;
          const touched = EDGES.some((e) => e.p === k && hover === `j${e.j}`);
          const lit = hover === id || touched;
          return (
            <rect
              key={id}
              x="340"
              y={y - 4}
              width="16"
              height="8"
              rx="4"
              fill={lit ? "var(--tx)" : "var(--ln-strong)"}
              fillOpacity={lit ? 1 : hover ? 0.3 : 0.7}
              className="pop cursor-pointer" style={{ ["--d" as string]: `${500 + k * 50}ms` }}
              {...on(id)}
            />
          );
        })}
        {JUDGES.map((j, k) => {
          const id = `j${k}`;
          const lit = hover === id;
          return (
            <circle
              key={id}
              cx="74"
              cy={j.y}
              r={lit ? 9 : 7.5}
              fill={lit ? `var(--k-${j.k})` : "var(--sf)"}
              stroke={`var(--k-${j.k})`}
              strokeWidth="2"
              className="pop cursor-pointer" style={{ ["--d" as string]: `${200 + k * 90}ms` }}
              {...on(id)}
            />
          );
        })}
        {JUDGES.map((j, k) => (
          <circle key={`ring${k}`} cx="74" cy={j.y} r="7.5" fill="none" stroke={`var(--k-${j.k})`} strokeWidth="1.5" className="mark-ring pointer-events-none" style={{ ["--d" as string]: `${k * 0.7}s` }} />
        ))}
      </svg>
      <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-line pt-4 text-small text-muted">
        <span className="inline-flex items-center gap-2">
          <i className="h-[9px] w-[9px] rounded-full border-2" style={{ borderColor: "var(--k-blue)" }} />
          judges
        </span>
        <span className="inline-flex items-center gap-2">
          <i className="h-[6px] w-4 rounded-sm" style={{ background: "var(--ln-strong)" }} />
          submissions
        </span>
        <span className="text-small">Hover or tap a judge to see their queue.</span>
      </div>
    </div>
  );
}

/** A dark terminal: the one heavy surface on the page, because it is the one thing people copy. */
export function Terminal() {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText("git clone https://github.com/your-org/podium\ndocker compose up");
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div
      className="home-lift min-w-0 overflow-hidden rounded-[16px] border"
      style={{ background: "#0d0d12", borderColor: "#23232c", boxShadow: "var(--home-shadow-up)" }}
    >
      <div className="flex items-center gap-2 border-b px-4 py-3" style={{ borderColor: "#23232c" }}>
        <span className="h-[9px] w-[9px] rounded-full" style={{ background: "#ff6b62" }} aria-hidden="true" />
        <span className="h-[9px] w-[9px] rounded-full" style={{ background: "#f4c04e" }} aria-hidden="true" />
        <span className="h-[9px] w-[9px] rounded-full" style={{ background: "#4cc98a" }} aria-hidden="true" />
        <span className="ml-2 font-mono text-meta" style={{ color: "#9a9aa8" }}>deploy.sh</span>
        <button
          type="button"
          onClick={() => void copy()}
          className="sweep ml-auto inline-flex min-h-[32px] items-center rounded-[7px] border px-3 font-mono text-meta transition-colors duration-300"
          style={{ borderColor: "#34343f", color: "#e7e7ee", ["--sweep" as string]: "#ffffff", ["--sweep-fg" as string]: "#0d0d12" }}
        >
          {copied ? "Copied" : "Copy"}
          <span className="sr-only" role="status">{copied ? " to clipboard" : " the commands"}</span>
        </button>
      </div>
      <pre className="m-0 whitespace-pre-wrap px-[18px] py-5 font-mono text-meta leading-[1.9] [overflow-wrap:anywhere] sm:text-small sm:leading-[1.9]" style={{ color: "#e7e7ee" }}>
        <span style={{ color: "#4cc98a" }}>$ </span>
        {`git clone https://github.com/your-org/podium\n`}
        <span style={{ color: "#4cc98a" }}>$ </span>
        {`docker compose up  `}
        <span style={{ color: "#9a9aa8" }}>{`# api :4000 · web :3000 · db seeded automatically`}</span>
        {`\n`}
        <span style={{ color: "#4cc98a" }}>$ </span>
        {`open http://localhost:3000  `}
        <span style={{ color: "#9a9aa8" }}>{`# no cloud account, no API key, offline-ready`}</span>
      </pre>
    </div>
  );
}

