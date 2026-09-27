import { tone, type Tone } from "./tone";

/**
 * A small, non-interactive hero mark: judges on the left, projects on the right,
 * evaluations travelling along each assignment. Pure CSS (offset-path), no
 * JavaScript. The static drawing is the finished state.
 */

const JUDGES: Array<{ y: number; k: Tone }> = [
  { y: 52, k: "orange" },
  { y: 130, k: "cyan" },
  { y: 208, k: "violet" },
];
const PROJECTS = [
  { y: 30, w: 58 },
  { y: 90, w: 76 },
  { y: 150, w: 46 },
  { y: 210, w: 68 },
];
const EDGES: Array<[number, number]> = [
  [0, 0],
  [0, 1],
  [1, 1],
  [1, 2],
  [2, 2],
  [2, 3],
];

const path = (j: number, p: number) =>
  `M64,${JUDGES[j]!.y} C170,${JUDGES[j]!.y} 200,${PROJECTS[p]!.y + 8} 300,${PROJECTS[p]!.y + 8}`;

export function HeroMark() {
  return (
    <div
      className="home-dots relative mx-auto w-full max-w-[520px] overflow-hidden rounded-[22px] border border-line p-[clamp(14px,2.4vw,28px)]"
      style={{ backgroundColor: "var(--sf)", boxShadow: "var(--home-shadow-up)" }}
      role="img"
      aria-label="Three judges, each in their own colour, send evaluations to the projects they review."
    >
      <div
        className="pointer-events-none absolute inset-0"
        aria-hidden="true"
        style={{
          background:
            "radial-gradient(280px 200px at 0% 0%, var(--k-blue-s), transparent 70%), radial-gradient(280px 200px at 100% 100%, var(--k-violet-s), transparent 70%)",
        }}
      />
      <svg viewBox="0 0 400 250" className="relative block h-auto w-full overflow-visible" aria-hidden="true">
        {EDGES.map(([j, p], i) => (
          <path key={i} d={path(j, p)} fill="none" stroke={`var(--k-${JUDGES[j]!.k})`} strokeOpacity="0.4" strokeWidth="1.6" strokeLinecap="round" />
        ))}
        {EDGES.map(([j, p], i) => (
          <circle
            key={`d${i}`}
            r="4"
            fill={`var(--k-${JUDGES[j]!.k})`}
            className="mark-dot"
            style={{ offsetPath: `path("${path(j, p)}")`, ["--d" as string]: `${i * 0.7}s` }}
          />
        ))}
        {PROJECTS.map((pr, i) => (
          <g key={i}>
            <rect x="300" y={pr.y} width="76" height="16" rx="8" fill="var(--el)" stroke="var(--ln)" />
            <rect
              x="300"
              y={pr.y}
              width={pr.w}
              height="16"
              rx="8"
              fill="var(--k-blue)"
              fillOpacity="0.9"
              className="mark-bar"
              style={{ ["--d" as string]: `${i * 0.5}s` }}
            />
          </g>
        ))}
        {JUDGES.map((jd, i) => (
          <g key={i} style={tone(jd.k)}>
            <circle cx="64" cy={jd.y} r="16" style={{ fill: "var(--ks)" }} />
            <circle cx="64" cy={jd.y} r="16" fill="none" stroke="var(--k)" strokeWidth="2" className="mark-ring" style={{ ["--d" as string]: `${i * 0.8}s` }} />
            <circle cx="64" cy={jd.y} r="5" fill="var(--k)" />
          </g>
        ))}
        <text x="64" y="246" textAnchor="middle" fill="var(--mu)" className="font-mono" style={{ fontSize: 10, letterSpacing: "0.1em" }}>JUDGES</text>
        <text x="338" y="246" textAnchor="middle" fill="var(--mu)" className="font-mono" style={{ fontSize: 10, letterSpacing: "0.1em" }}>PROJECTS</text>
      </svg>
    </div>
  );
}
