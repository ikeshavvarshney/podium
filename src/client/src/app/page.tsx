import type { Metadata } from "next";
import Link from "next/link";
import { HeroMark } from "@/components/home/hero-mark";
import { RankLab } from "@/components/home/hero-stage";
import { AssignmentDiagram, NormalizationCurves, SlopeChart, Terminal } from "@/components/home/interactive";
import {
  IsolationRules,
  PermissionsTable,
  PhaseTimeline,
  SectionHead,
  SpecList,
  StackFlow,
  StatBand,
  TierList,
} from "@/components/home/sections";
import { RevealObserver } from "@/components/home/reveal";
import { tone } from "@/components/home/tone";
import { get } from "@/lib/api";
import "./home.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "podium: judging infrastructure for hackathons",
  description:
    "Self-hostable, open-source hackathon platform: submissions, teams, judge assignment, weighted rubrics, cross-judge normalization, community voting and auditable results.",
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    title: "podium: judging infrastructure for hackathons",
    description:
      "Every number podium produces traces back to the evaluations that made it. MIT licensed, self-hosted, offline-ready.",
    siteName: "podium",
  },
  twitter: { card: "summary", title: "podium: judging infrastructure for hackathons" },
};

interface PlatformStats {
  events: number;
  submissions: number;
  judges: number;
  ballots: number;
  votes: number;
  featured: {
    slug: string;
    name: string;
    submissions: number;
    judges: number;
    reviewsPerSubmission: number;
    resultsPublished: boolean;
  } | null;
  movement: Array<{ rank: number; rawRank: number; name: string; normalized: number; delta: number }>;
}

const EMPTY: PlatformStats = {
  events: 0,
  submissions: 0,
  judges: 0,
  ballots: 0,
  votes: 0,
  featured: null,
  movement: [],
};

/** Page column and vertical rhythm. Sections separate by space, not by rules, apart from the two tinted bands. */
const COLUMN = "mx-auto max-w-[1400px] px-[clamp(20px,4vw,32px)]";
const SECTION = "py-[clamp(44px,5.5vw,76px)]";

function Arrow() {
  return (
    <svg className="arr" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

export default async function HomePage() {
  let stats = EMPTY;
  try {
    stats = await get<PlatformStats>("/stats");
  } catch {
    // The landing page renders without a live API; the counters read zero.
  }

  const featured = stats.featured;
  const cards = [
    { value: String(featured?.submissions ?? stats.submissions), label: "Submissions this weekend" },
    { value: String(featured?.judges ?? stats.judges), label: "Judges on the panel" },
    { value: String(featured?.reviewsPerSubmission ?? 3), label: "Evaluations per project" },
    { value: stats.votes.toLocaleString(), label: "Community votes cast" },
  ];

  return (
    <main className="home">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "SoftwareApplication",
            name: "podium",
            applicationCategory: "BusinessApplication",
            operatingSystem: "Web, Docker",
            license: "https://opensource.org/licenses/MIT",
            description:
              "Self-hostable hackathon submission and judging platform with weighted rubrics and cross-judge normalization.",
          }),
        }}
      />
      <RevealObserver />
      {/* Hero */}
      <section className="home-hero flex pb-[clamp(32px,4.4vw,56px)] pt-[clamp(28px,4vw,56px)] lg:items-center">
        <div className={`${COLUMN} grid w-full items-center gap-[clamp(28px,4vw,64px)] lg:grid-cols-[minmax(0,1.02fr)_minmax(0,1fr)]`}>
          <div className="min-w-0">
            <div className="inline-flex items-center gap-2.5 rounded-full border border-line bg-surface py-1 pl-1.5 pr-3 font-mono text-label uppercase tracking-label text-muted" style={{ boxShadow: "var(--home-shadow)" }}>
              <span className="rounded-full px-2 py-[2px]" style={{ background: "var(--k-green-s)", color: "var(--k-green-t)" }}>MIT</span>
              self-hostable · v0.4
            </div>
            <h1 className="home-h1 mt-[clamp(18px,2.4vw,30px)] max-w-[18ch]">
              Judging infrastructure for hackathons that want to be <span className="home-mark">fair.</span>
            </h1>
            <p className="home-lead mt-[clamp(16px,2.2vw,28px)] max-w-[46ch] !text-[clamp(0.9375rem,1.15vw,1.0625rem)]">
              podium runs the whole event: submissions and teams, judge assignment, weighted rubrics, cross-judge
              normalization, and community voting. Organizers configure the criteria once. Every number the
              platform produces can be traced back to the evaluations that made it.
            </p>
            <div className="mt-[clamp(24px,3vw,38px)] flex flex-wrap items-center gap-x-3 gap-y-3">
              <Link href="/events" className="hb hb-solid !min-h-[46px] !px-5 !text-[0.9375rem]">
                Browse events
                <Arrow />
              </Link>
              <a href="#self-host" className="hb !min-h-[46px] !px-5 !text-[0.9375rem]">
                Self-host it
              </a>
              <span className="text-small text-muted">No cloud account, no API key, offline-ready.</span>
            </div>
          </div>

          <HeroMark />
        </div>
      </section>

      {/* Proof points */}
      <section className={`${COLUMN} pb-[clamp(32px,5vw,64px)] pt-[clamp(12px,2vw,24px)]`}>
        <StatBand stats={cards} />
      </section>

      {/* Playable ranking */}
      <section className={`${COLUMN} ${SECTION}`}>
        <div className="grid items-end gap-[clamp(24px,4vw,48px)] lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
          <div className="min-w-0">
            <SectionHead k="blue" label="Try it" title="Change who reviewed what." accent="reviewed what.">
              Three judges, three habits. When each judge only sees some of the projects, raw averages reward
              whoever drew the generous reader. Switch to normalized scoring, or let everyone read everything,
              and watch the ranking settle on the strongest project.
            </SectionHead>
          </div>
          <div className="min-w-0">
            <ol className="m-0 grid list-none gap-3 p-0 text-body leading-[1.55] text-muted">
              <li className="flex gap-3"><i className="mt-[9px] h-1.5 w-1.5 flex-none rounded-full" style={{ background: "var(--k-blue)" }} />Click a cell to add or remove a review.</li>
              <li className="flex gap-3"><i className="mt-[9px] h-1.5 w-1.5 flex-none rounded-full" style={{ background: "var(--k-violet)" }} />Flip between raw average and normalized.</li>
              <li className="flex gap-3"><i className="mt-[9px] h-1.5 w-1.5 flex-none rounded-full" style={{ background: "var(--k-green)" }} />Read the standings and how far each project moved.</li>
            </ol>
          </div>
        </div>
        <div className="reveal mt-[clamp(28px,3.6vw,44px)] min-w-0">
          <RankLab />
        </div>
      </section>

      {/* Lifecycle */}
      <section className={`${COLUMN} ${SECTION}`}>
        <SectionHead k="blue" align="end" label="The lifecycle" title="Five phases, each with a hard boundary." accent="a hard boundary.">
          A phase cannot start until the one before it closes. That is what makes the audit trail meaningful:
          nobody scores a submission that is still being edited.
        </SectionHead>
        <PhaseTimeline />
      </section>

      {/* Normalization */}
      <section className={`${COLUMN} pb-[clamp(44px,5.5vw,76px)]`}>
        <div className="grid items-center gap-[clamp(28px,5vw,64px)] lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
          <div className="min-w-0">
            <SectionHead k="violet" label="Normalization" title="Two judges, two different rulers." accent="two different rulers.">
              A harsh judge&apos;s 3.4 and a generous judge&apos;s 4.6 can describe the same project. Raw
              averages quietly punish whoever drew the harsh panel. podium standardizes every evaluation
              against the other evaluations that judge cast, then re-ranks, so the correction is a property of
              the panel, not of the project.
            </SectionHead>

            <div
              className="mt-8 flex flex-wrap items-center justify-center gap-x-8 gap-y-5 overflow-x-auto rounded-[14px] border px-5 py-6 font-mono"
              style={{ ...tone("violet"), background: "var(--ks)", borderColor: "var(--k)" }}
            >
              <div className="flex items-center gap-3">
                <span className="text-title">z</span>
                <span className="text-title text-muted">=</span>
                <span className="inline-flex flex-col items-center gap-1.5">
                  <span className="whitespace-nowrap px-2 text-body">
                    x − μ<sub>j</sub>
                  </span>
                  <span className="h-px w-full bg-text" />
                  <span className="text-body">
                    σ<sub>j</sub>
                  </span>
                </span>
              </div>
              <span className="min-h-[38px] w-px self-stretch bg-line-strong/40" />
              <div className="flex items-center gap-3 whitespace-nowrap text-prose">
                <span>display</span>
                <span className="text-muted">=</span>
                <span>50 + 10z</span>
              </div>
            </div>

            <details className="group mt-4">
              <summary className="home-link inline-flex min-h-[44px] cursor-pointer items-center text-body font-medium" style={{ color: "var(--k-violet-t)" }}>
                What the symbols mean, and the small-sample fallback
              </summary>
              <div className="mt-3 grid gap-2">
                {[
                  { sym: "x", text: "one judge score: a single weighted evaluation, 1-5 across the criteria" },
                  { sym: "μⱼ", text: "the mean of every score judge j gave" },
                  { sym: "σⱼ", text: "the spread of judge j's scores, their standard deviation" },
                  { sym: "z", text: "the same score restated in spreads away from that judge's own mean" },
                ].map((r) => (
                  <div key={r.sym} className="grid items-baseline gap-2.5 [grid-template-columns:28px_minmax(0,1fr)]">
                    <span className="font-mono text-small">{r.sym}</span>
                    <span className="text-ui leading-[1.55] text-muted">{r.text}</span>
                  </div>
                ))}
              </div>
              <p className="mt-3.5 text-small leading-[1.6] text-muted">
                Fewer than two evaluations from a judge leaves the spread undefined; those evaluations fall back
                to event-mean centering and are flagged in the export.
              </p>
            </details>
          </div>

          <div className="reveal min-w-0">
            <NormalizationCurves />
          </div>
        </div>
      </section>

      {/* Rank movement: compact diagram on one side, heading and text top-aligned on the other */}
      <section className={`${COLUMN} pb-[clamp(56px,7.2vw,116px)] pt-[clamp(18px,2.6vw,42px)]`}>
        <div className="grid items-start gap-[clamp(28px,5vw,64px)] lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
          <div className="reveal order-2 mx-auto w-full min-w-0 max-w-[420px] lg:order-1">
            <SlopeChart />
          </div>

          <div className="order-1 min-w-0 lg:order-2">
            <SectionHead k="violet" label="What the correction does" title="Where the ranks actually move." accent="actually move." />
            <div className="mt-8 min-w-0">
              <div className="flex items-baseline justify-between gap-3 border-b border-line pb-3">
                <h3 className="m-0 font-mono text-label font-normal uppercase tracking-label text-muted">Top six, live</h3>
                <span className="font-mono text-label text-muted">raw to move</span>
              </div>
              {stats.movement.length === 0 ? (
                <p className="mt-5 max-w-[46ch] text-body leading-[1.6] text-muted">
                  Nothing published yet. Once an organizer publishes a normalization run, the projects whose rank
                  the correction moved appear here, with the size of the move.
                </p>
              ) : (
                <ol className="m-0 list-none p-0">
                  {stats.movement.map((m) => {
                    const k = m.delta > 0 ? "green" : m.delta < 0 ? "orange" : "blue";
                    return (
                      <li
                        key={m.name}
                        className="-mx-3 grid items-center gap-3 rounded-[10px] border-b border-line px-3 py-3 [grid-template-columns:26px_minmax(0,1fr)_auto_auto] [transition:background-color_260ms,transform_260ms] hover:translate-x-[3px] hover:bg-elevated"
                      >
                        <span className="font-mono text-small text-muted">{m.rank}</span>
                        <span className="truncate text-body font-medium">{m.name}</span>
                        <span className="font-mono text-small text-muted">raw {m.rawRank}</span>
                        <span
                          className="min-w-[48px] rounded-[6px] px-2 py-[3px] text-center font-mono text-small"
                          style={m.delta === 0 ? { color: "var(--mu)" } : { ...tone(k), background: "var(--ks)", color: "var(--kt)" }}
                        >
                          {m.delta > 0 ? `+${m.delta}` : m.delta === 0 ? "held" : m.delta}
                        </span>
                      </li>
                    );
                  })}
                </ol>
              )}
            </div>
            {featured?.resultsPublished ? (
              <Link href={`/events/${featured.slug}/results`} className="hb mt-6">
                See the full matrix
                <Arrow />
              </Link>
            ) : null}
          </div>
        </div>
      </section>

      {/* Self-host */}
      <section id="self-host" className="scroll-mt-[70px] border-y border-line bg-elevated">
        <div className={`${COLUMN} py-[clamp(56px,7.2vw,118px)]`}>
          <div className="grid items-start gap-[clamp(28px,5vw,64px)] lg:grid-cols-2">
            <div className="min-w-0">
              <SectionHead k="cyan" label="Operations" title="Self-host it in an afternoon." accent="in an afternoon.">
                One container, one Postgres database, no vendor account and no outbound calls at runtime. Every
                action in the interface has a REST equivalent, so an organizer can script the parts of an event
                that repeat.
              </SectionHead>
              <SpecList />
            </div>
            <div className="reveal min-w-0">
              <Terminal />
              <StackFlow />
            </div>
          </div>
        </div>
      </section>

      {/* Assignment and isolation */}
      <section className={`${COLUMN} ${SECTION}`}>
        <div className="grid items-center gap-[clamp(28px,5vw,64px)] lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
          <div className="reveal order-2 min-w-0 lg:order-1">
            <AssignmentDiagram />
          </div>
          <div className="order-1 min-w-0 lg:order-2">
            <SectionHead k="blue" label="Assignment and isolation" title="Nobody reads an evaluation they did not cast." accent="did not cast.">
              The assignment engine allocates work so every submission collects the same number of independent
              reviews, balancing load across the panel and honouring conflict-of-interest declarations. Judges
              see their own queue and nothing else: peer scores are filtered at the API layer, not hidden in
              the interface.
            </SectionHead>
            <IsolationRules />
          </div>
        </div>
      </section>

      {/* Permissions */}
      <section className={`${COLUMN} pb-[clamp(44px,5.5vw,76px)]`}>
        <SectionHead k="pink" label="Permissions" title="Who sees what." accent="what.">
          Roles are granted per event, so the same account can be a participant in one event and a judge in
          another. Every cell below is enforced by the API, not by the interface.
        </SectionHead>
        <PermissionsTable />
      </section>

      {/* Capabilities */}
      <section className={`${COLUMN} pb-[clamp(44px,5.5vw,76px)]`}>
        <SectionHead k="violet" align="end" label="Capabilities" title="Four tiers, one data model." accent="one data model." />
        <TierList />
      </section>

      {/* Closing call to action */}
      <section className={`${COLUMN} pb-[clamp(44px,6vw,84px)]`}>
        <div
          className="reveal home-dots relative overflow-hidden rounded-[28px] border border-line px-[clamp(24px,6vw,72px)] py-[clamp(56px,8vw,104px)]"
          style={{ backgroundColor: "var(--sf)", boxShadow: "var(--home-shadow-up)" }}
        >
          <div
            className="pointer-events-none absolute inset-0"
            style={{
              background:
                "linear-gradient(115deg, var(--k-blue-s) 0%, transparent 38%, transparent 60%, var(--k-violet-s) 82%, var(--k-pink-s) 100%), radial-gradient(420px 260px at 100% 0%, var(--k-orange-s), transparent 72%)",
            }}
          />
          <svg viewBox="0 0 420 220" preserveAspectRatio="xMaxYMid meet" className="pointer-events-none absolute inset-y-6 right-[clamp(16px,4vw,56px)] hidden h-[calc(100%-48px)] w-[min(44%,520px)] md:block" aria-hidden="true">
            <g fill="none" strokeLinecap="round" strokeWidth="1.6">
              <path pathLength={1} className="draw" d="M20,40 C120,40 150,110 250,110 S370,60 410,60" stroke="var(--k-blue)" strokeOpacity="0.5" />
              <path pathLength={1} className="draw" d="M20,110 C110,110 160,110 250,110 S360,150 410,150" stroke="var(--k-violet)" strokeOpacity="0.5" />
              <path pathLength={1} className="draw" d="M20,180 C120,180 150,110 250,110 S370,110 410,110" stroke="var(--k-pink)" strokeOpacity="0.45" />
            </g>
            <g>
              <circle cx="250" cy="110" r="6" fill="var(--sf)" stroke="var(--tx)" strokeWidth="1.6" className="pop" style={{ ["--d" as string]: "500ms" }} />
              <circle cx="20" cy="40" r="4" fill="var(--k-blue)" className="pop" style={{ ["--d" as string]: "200ms" }} />
              <circle cx="20" cy="110" r="4" fill="var(--k-violet)" className="pop" style={{ ["--d" as string]: "300ms" }} />
              <circle cx="20" cy="180" r="4" fill="var(--k-pink)" className="pop" style={{ ["--d" as string]: "400ms" }} />
              <circle cx="410" cy="60" r="4" fill="var(--k-green)" className="pop" style={{ ["--d" as string]: "700ms" }} />
              <circle cx="410" cy="110" r="4" fill="var(--k-green)" className="pop" style={{ ["--d" as string]: "800ms" }} />
              <circle cx="410" cy="150" r="4" fill="var(--k-green)" className="pop" style={{ ["--d" as string]: "900ms" }} />
            </g>
          </svg>
          <div className="relative">
            <h2 className="home-h2 max-w-[16ch]">Run the next event on results you can defend.</h2>
          </div>
          <div className="relative mt-[clamp(26px,4vw,40px)] flex flex-wrap items-center gap-3">
            <Link href="/events" className="hb hb-solid">
              Browse events
              <Arrow />
            </Link>
            <a href="#self-host" className="hb">
              Self-host it
            </a>
            <span className="text-small text-muted">No cloud account, no API key, offline-ready.</span>
          </div>
        </div>
      </section>
    </main>
  );
}
