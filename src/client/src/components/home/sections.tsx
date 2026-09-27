import type { ReactNode } from "react";
import { tone, type Tone } from "./tone";

/** Static homepage sections. Interactive ones live in interactive.tsx so this file ships no client code. */

export function SectionHead({
  k,
  label,
  title,
  accent,
  children,
  className = "",
  align = "start",
}: {
  k: Tone;
  label: string;
  title: string;
  /** A closing part of the title set in the serif italic. The text itself is unchanged. */
  accent?: string;
  children?: ReactNode;
  className?: string;
  /** "end" right-aligns the block from tablet up, so full-width headings can alternate sides down the page. */
  align?: "start" | "end";
}) {
  const end = align === "end";
  return (
    <div className={`min-w-0 ${end ? "md:text-right" : ""} ${className}`} style={tone(k)}>
      <div className={`flex ${end ? "md:justify-end" : ""}`}>
        <div className="home-eyebrow">
          <i aria-hidden="true" />
          {label}
        </div>
      </div>
      <h2 className={`home-h2 mt-5 max-w-[20ch] ${end ? "md:ml-auto" : ""}`}>
        {accent && title.endsWith(accent) ? (
          <>
            {title.slice(0, title.length - accent.length)}
            <em className="type-accent">{accent}</em>
          </>
        ) : (
          title
        )}
      </h2>
      {children ? <div className={`home-lead mt-6 max-w-[58ch] ${end ? "md:ml-auto" : ""}`}>{children}</div> : null}
    </div>
  );
}

export interface Stat {
  value: string;
  label: string;
}

const STAT_TONES: Tone[] = ["cyan", "blue", "violet", "pink"];

export function StatBand({ stats }: { stats: Stat[] }) {
  return (
    <dl className="m-0 grid grid-cols-2 lg:grid-cols-4">
      {stats.map((s, i) => (
        <div
          key={s.label}
          style={tone(STAT_TONES[i % STAT_TONES.length]!)}
          className="group min-w-0 border-t border-line py-6 pr-4 lg:border-l lg:border-t-0 lg:px-8 lg:py-2 lg:first:border-l-0 lg:first:pl-0"
        >
          <dd className="m-0 flex items-center gap-2.5 text-[clamp(1.6rem,2.6vw,2.2rem)] font-semibold leading-none tracking-[-0.03em] tabular-nums">
            <span className="h-2 w-2 flex-none rounded-full transition-transform duration-300 group-hover:scale-[2]" style={{ background: "var(--k)" }} aria-hidden="true" />
            {s.value}
          </dd>
          <dt className="mt-3 max-w-[24ch] text-ui leading-[1.45] text-muted">{s.label}</dt>
        </div>
      ))}
    </dl>
  );
}

const PHASES: Array<{ num: string; k: Tone; title: string; body: string; gate: string }> = [
  {
    num: "01",
    k: "blue",
    title: "Configure",
    body: "Dates, tracks, prizes, custom submission questions, rubric criteria and their weights.",
    gate: "weights total 100",
  },
  {
    num: "02",
    k: "violet",
    title: "Collect",
    body: "Teams form by invite link and edit their draft freely. Every change is recorded with a diff.",
    gate: "submission deadline",
  },
  {
    num: "03",
    k: "cyan",
    title: "Assign",
    body: "Batch or algorithmic allocation, balanced across the panel and respecting conflicts.",
    gate: "N reviews per project",
  },
  {
    num: "04",
    k: "green",
    title: "Score",
    body: "Judges work a private queue, scoring each criterion 1-5. Arithmetic happens server-side.",
    gate: "scoring window closes",
  },
  {
    num: "05",
    k: "orange",
    title: "Normalize",
    body: "Standardize per judge, re-rank, then publish raw and corrected side by side.",
    gate: "organizer publishes",
  },
];

export function PhaseTimeline() {
  return (
    <ol className="phase-list reveal m-0 mt-[clamp(32px,4.4vw,52px)] grid list-none gap-9 p-0 md:grid-cols-5 md:gap-8">
      {PHASES.map((p, i) => (
        <li
          key={p.num}
          tabIndex={0}
          className="phase-item group relative min-w-0 rounded-[10px] pl-10 md:pl-0 md:pt-11"
          style={{ ...tone(p.k), ["--d" as string]: `${250 + i * 130}ms` }}
        >
          <span
            className="phase-node absolute left-[9px] top-[6px] h-[13px] w-[13px] rounded-full border-2 bg-surface md:left-0 md:top-[9px]"
            style={{ borderColor: "var(--k)" }}
            aria-hidden="true"
          />
          <span className="font-mono text-label tracking-stamp text-muted" aria-hidden="true">{p.num}</span>
          <h3 className="m-0 mt-1 text-[1.25rem] font-semibold tracking-[-0.02em]">
            <span className="sr-only">Phase {p.num}: </span>
            {p.title}
          </h3>
          <p className="mt-2.5 text-body leading-[1.6] text-muted">{p.body}</p>
          <div
            className="phase-gate mt-4 inline-block rounded-[6px] px-2 py-[5px] font-mono text-label uppercase tracking-stamp"
            style={{ background: "var(--ks)", color: "var(--kt)" }}
          >
            closes on · {p.gate}
          </div>
        </li>
      ))}
    </ol>
  );
}

const ISOLATION_RULES: Array<{ code: string; k: Tone; text: string }> = [
  {
    code: "403",
    k: "pink",
    text: "A judge requesting another judge's evaluation is refused at the API, not filtered in the client.",
  },
  {
    code: "COI",
    k: "orange",
    text: "Declared conflicts remove a judge from that project's candidate pool before allocation runs.",
  },
  {
    code: "SEAL",
    k: "green",
    text: "A submitted evaluation is immutable; corrections are new revisions with both versions retained.",
  },
  {
    code: "LOG",
    k: "violet",
    text: "Every read of a score writes an audit entry naming the actor, the purpose and the time.",
  },
];

export function IsolationRules() {
  return (
    <ul className="m-0 mt-10 grid list-none p-0">
      {ISOLATION_RULES.map((r) => (
        <li
          key={r.code}
          style={tone(r.k)}
          className="-mx-3 flex items-baseline gap-4 rounded-[10px] border-t border-line px-3 py-4 transition-[background-color,transform] duration-300 first:border-t-0 hover:translate-x-[3px] hover:bg-[var(--ks)]"
        >
          <span
            className="min-w-[52px] flex-none rounded-[6px] px-2 py-[4px] text-center font-mono text-label tracking-stamp"
            style={{ background: "var(--ks)", color: "var(--kt)" }}
          >
            {r.code}
          </span>
          <span className="text-body leading-[1.6]">{r.text}</span>
        </li>
      ))}
    </ul>
  );
}

const PERM_ROLES: Array<{ name: string; k: Tone }> = [
  { name: "visitor", k: "cyan" },
  { name: "participant", k: "blue" },
  { name: "judge", k: "violet" },
  { name: "organizer", k: "orange" },
];

const PERM_ROWS: Array<[string, number, number, number, number]> = [
  ["Browse the public gallery", 1, 1, 1, 1],
  ["Vote in community voting", 1, 1, 0, 1],
  ["Create and edit a submission", 0, 1, 0, 1],
  ["Score an assigned queue", 0, 0, 1, 0],
  ["Read another judge's evaluation", 0, 0, 0, 1],
  ["See aggregate standings", 0, 0, 0, 1],
  ["Publish results and export", 0, 0, 0, 1],
];

const GRID = "[grid-template-columns:minmax(200px,1.7fr)_repeat(4,minmax(88px,1fr))]";

export function PermissionsTable() {
  return (
    <div
      role="region"
      aria-label="Permissions by role, scrolls sideways on narrow screens"
      tabIndex={0}
      className="relative mt-[clamp(26px,3.6vw,40px)] overflow-x-auto rounded-[16px] border border-line bg-surface"
      style={{ boxShadow: "var(--home-shadow)" }}
    >
      <div className="min-w-[min(660px,172vw)]">
        <div className={`grid ${GRID} border-b border-line bg-elevated px-5 py-3.5 font-mono text-label uppercase tracking-label text-muted`}>
          <span className="sticky left-0 z-[1] bg-elevated">capability</span>
          {PERM_ROLES.map((role) => (
            <span key={role.name} style={tone(role.k)} className="flex items-center justify-center gap-2 text-text">
              <i className="h-[7px] w-[7px] rounded-full" style={{ background: "var(--k)" }} aria-hidden="true" />
              {role.name}
            </span>
          ))}
        </div>
        {PERM_ROWS.map((row) => (
          <div
            key={row[0]}
            className={`grid ${GRID} items-center border-b border-line px-5 py-3.5 transition-colors duration-300 last:border-b-0 hover:bg-elevated`}
          >
            <span className="sticky left-0 z-[1] bg-surface pr-3 text-body">{row[0]}</span>
            {[row[1], row[2], row[3], row[4]].map((v, i) => (
              <span key={i} className="flex justify-center" style={tone("pink")}>
                {v ? (
                  <span className="grid h-[22px] w-[22px] place-items-center rounded-full" style={{ background: "var(--ks)", color: "var(--kt)" }}>
                    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M5 12.5l4.5 4.5L19 7.5" />
                    </svg>
                    <span className="sr-only">allowed</span>
                  </span>
                ) : (
                  <span className="font-mono text-ui text-muted">
                    <span aria-hidden="true">-</span>
                    <span className="sr-only">not allowed</span>
                  </span>
                )}
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

const TIERS: Array<{
  tier: string;
  name: string;
  k: Tone;
  items: Array<{ title: string; body: string }>;
}> = [
  {
    tier: "Tier 1",
    name: "Core",
    k: "cyan",
    items: [
      {
        title: "Events and teams",
        body: "Configurable dates, tracks, prizes and custom submission questions. Teams form through single-use invite links.",
      },
      {
        title: "Submissions with drafts",
        body: "Edit until the deadline, then a hard close. Every edit lands in the audit log with a diff.",
      },
    ],
  },
  {
    tier: "Tier 2",
    name: "Judging",
    k: "blue",
    items: [
      {
        title: "Assignment engine",
        body: "Batch or algorithmic allocation so each project gets N reviews and no judge sees a peer's evaluation.",
      },
      {
        title: "Weighted rubrics",
        body: "Organizers define criteria and weights per event. Judges score 1-5; the arithmetic happens server-side.",
      },
      {
        title: "Comparative ranking",
        body: "An alternative to absolute scores: judges order a small group of projects best-to-worst, combined into a ranking with a Borda count.",
      },
    ],
  },
  {
    tier: "Tier 3",
    name: "Public",
    k: "pink",
    items: [
      {
        title: "Community voting",
        body: "Open link, email-gated or authenticated. Quadratic option, shuffled evaluations, rate limits and duplicate detection.",
      },
      {
        title: "Comments and moderation",
        body: "Public comments on gallery projects, with anti-abuse flags and an audit trail organizers can read without a database client.",
      },
    ],
  },
  {
    tier: "Tier 4",
    name: "Stretch",
    k: "violet",
    items: [
      {
        title: "API and webhooks",
        body: "Every UI action has a REST equivalent with an OpenAPI spec. Bulk import, CSV export, embeddable gallery.",
      },
      {
        title: "Certificates and signed records",
        body: "Participation certificates on demand, and a dated, cryptographically signed, publicly verifiable record of what each judge reviewed.",
      },
    ],
  },
];

export function TierList() {
  return (
    <div className="mt-[clamp(28px,4vw,44px)]">
      {TIERS.map((t) => (
        <section
          key={t.tier}
          style={tone(t.k)}
          className="reveal group relative grid gap-x-10 gap-y-5 border-t border-line py-[clamp(18px,2.4vw,26px)] md:grid-cols-[200px_minmax(0,1fr)]"
        >
          <span className="absolute -top-px left-0 h-[2px] w-full origin-left scale-x-[0.07] transition-transform duration-500 ease-out group-hover:scale-x-100" style={{ background: "var(--k)" }} aria-hidden="true" />
          <header>
            <h3 className="m-0 text-[1.375rem] font-semibold tracking-[-0.025em]">{t.tier}</h3>
            <span
              className="mt-2 inline-block rounded-[6px] px-2 py-[3px] font-mono text-label uppercase tracking-stamp"
              style={{ background: "var(--ks)", color: "var(--kt)" }}
            >
              {t.name}
            </span>
          </header>
          <ul className="m-0 grid list-none gap-x-10 gap-y-6 p-0 sm:grid-cols-2">
            {t.items.map((f) => (
              <li key={f.title} className="min-w-0">
                <h4 className="m-0 text-title font-semibold tracking-[-0.015em]">{f.title}</h4>
                <p className="mt-2 max-w-[52ch] text-body leading-[1.65] text-muted">{f.body}</p>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

const SPECS: Array<{ label: string; value: string; k: Tone }> = [
  { label: "Runtime", value: "Node 22 + Postgres 16", k: "green" },
  { label: "Frontend", value: "Next.js 15, React 19, no CDN calls", k: "blue" },
  { label: "Auth", value: "Argon2id sessions, no third party", k: "violet" },
  { label: "License", value: "MIT", k: "orange" },
];

export function SpecList() {
  return (
    <dl className="m-0 mt-9 grid grid-cols-2 gap-x-7 gap-y-6">
      {SPECS.map((s) => (
        <div key={s.label} style={{ ...tone(s.k), borderTopColor: "var(--k)" }} className="border-t-2 pt-3 transition-transform duration-300 hover:-translate-y-0.5">
          <dt className="font-mono text-label uppercase tracking-label text-muted">{s.label}</dt>
          <dd className="m-0 mt-1.5 text-body leading-[1.45]">{s.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** The three containers, with what flows between them. No outbound arrow, on purpose. */
export function StackFlow() {
  const nodes: Array<{ name: string; port: string; k: Tone }> = [
    { name: "web", port: ":3000", k: "blue" },
    { name: "api", port: ":4000", k: "violet" },
    { name: "postgres", port: "seeded", k: "green" },
  ];
  return (
    <div className="mt-4 flex items-center rounded-[14px] border border-line bg-surface p-4" style={{ boxShadow: "var(--home-shadow)" }}>
      {nodes.map((n, i) => (
        <div key={n.name} className="stack-node flex min-w-0 flex-1 items-center" style={{ ["--d" as string]: `${i * 160}ms` }}>
          <div className="min-w-0 flex-1 rounded-[10px] border px-3 py-2.5 text-center" style={{ ...tone(n.k), background: "var(--ks)", borderColor: "var(--k)" }}>
            <div className="text-body font-medium" style={{ color: "var(--kt)" }}>{n.name}</div>
            <div className="font-mono text-meta text-muted">{n.port}</div>
          </div>
          {i < nodes.length - 1 ? (
            <svg viewBox="0 0 32 12" className="h-3 w-6 flex-none sm:w-8" aria-hidden="true">
              <path d="M0 6 H28" className="home-flow" fill="none" stroke="var(--ln-strong)" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          ) : null}
        </div>
      ))}
    </div>
  );
}
