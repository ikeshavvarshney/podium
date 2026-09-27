"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ApiError, get, put } from "@/lib/api";
import { hue } from "@/lib/hues";
import { Notice } from "@/components/ui/notice";
import { StatusChip } from "@/components/ui/status-chip";
import { PageStatus } from "@/components/ui/page-status";
import { Segmented } from "@/components/ui/segmented";

interface VotingConfig {
  id: string | null;
  enabled: boolean;
  access: "OPEN_LINK" | "EMAIL_GATED" | "AUTHENTICATED";
  method: "SINGLE" | "QUADRATIC";
  creditBudget: number;
  hideResults: boolean;
  shuffleBallot: boolean;
  allowJudges: boolean;
  allowAdmins: boolean;
  maxVotesPerIpPerHour: number;
  methodLocked?: boolean;
  lockReason?: string | null;
}

interface Ballot {
  id: string;
  voter: string;
  email: string | null;
  submission: { id: string; name: string };
  weight: number;
  credits: number;
  createdAt: string;
  flag: string | null;
}

interface VoteResults {
  method: string;
  voters: number;
  totalWeight: number;
  hiddenUntilClose: boolean;
  standings: Array<{
    submissionId: string;
    weight: number;
    voters: number;
    credits: number;
    share: number;
    rank: number;
    submission: { id: string; name: string; track: { name: string } | null } | null;
  }>;
}

const ACCESS_LABEL: Record<VotingConfig["access"], string> = {
  OPEN_LINK: "Open link",
  EMAIL_GATED: "Email gated",
  AUTHENTICATED: "Signed in only",
};

export default function VotingManagerPage() {
  const params = useParams<{ slug: string }>();
  const slug = params.slug;

  const [tab, setTab] = useState<"view" | "setup">("view");
  const [config, setConfig] = useState<VotingConfig | null>(null);
  const [results, setResults] = useState<VoteResults | null>(null);
  const [ballots, setBallots] = useState<Ballot[]>([]);
  const [error, setError] = useState("");
  // Quadratic voting is not applied until the organizer states how many credits each voter gets.
  const [choosingQuadratic, setChoosingQuadratic] = useState(false);
  const [budgetDraft, setBudgetDraft] = useState("");
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    try {
      const [c, b] = await Promise.all([
        get<VotingConfig>(`/events/${slug}/voting/config`),
        get<Ballot[]>(`/events/${slug}/votes/ballots`),
      ]);
      setConfig(c);
      setBallots(b);
      try {
        setResults(await get<VoteResults>(`/events/${slug}/votes/results`));
      } catch {
        setResults(null);
      }
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "The voting manager could not be loaded.",
      );
    }
  }, [slug]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(changes: Partial<VotingConfig>) {
    setError("");
    try {
      const next = await put<VotingConfig>(`/events/${slug}/voting/config`, changes);
      setConfig(next);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 1600);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "That setting could not be saved.");
    }
  }

  if (!config) {
    return (
      <PageStatus eyebrow="Community voting" maxWidth="max-w-[900px]" error={error} size="sm" />
    );
  }

  const flagged = ballots.filter((b) => b.flag).length;
  const maxWeight = Math.max(1, ...(results?.standings.map((s) => s.weight) ?? [1]));

  const toggles: Array<{ key: keyof VotingConfig; label: string; hint: string }> = [
    {
      key: "enabled",
      label: "Voting is open",
      hint: "While this is off, every ballot is refused by the API, not just hidden in the UI.",
    },
    {
      key: "hideResults",
      label: "Hide tallies until voting closes",
      hint: "Organizers still see live standings. Everyone else gets a 403 until the window closes.",
    },
    {
      key: "shuffleBallot",
      label: "Randomize ballot order per voter",
      hint: "Deterministic per voter, different between voters, so position bias cannot accumulate.",
    },
    {
      key: "allowJudges",
      label: "Judges may also vote",
      hint: "Off by default: a judge already scores these projects on the rubric.",
    },
    {
      key: "allowAdmins",
      label: "Organizers may also vote",
      hint: "Off by default, for the same reason.",
    },
  ];

  return (
    <main className="screen max-w-[900px] pb-[120px] pt-[clamp(26px,4vw,40px)]">
      <Link href={`/events/${slug}/manage`} className="eyebrow mb-4 inline-flex items-center gap-[7px] hover:text-text">
        <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M14 6l-6 6 6 6" />
        </svg>
        Dashboard
      </Link>

      <div className="flex flex-wrap items-baseline gap-2.5">
        <div className="eyebrow">Community voting</div>
        {saved ? <StatusChip tone="success">Saved</StatusChip> : null}
      </div>
      <h1 className="display mt-3.5 text-page">Run and watch the poll.</h1>
      <p className="mt-3 max-w-[62ch] text-ui leading-[1.6] text-muted">
        Every ballot is visible to you, with who cast it. Nothing here is anonymized, and nothing is auto-rejected:
        suspicious ballots are flagged for your judgement.
      </p>

      {error ? (
        <Notice className="mt-5">{error}</Notice>
      ) : null}

      <Segmented
        label="Voting view"
        className="mt-6 max-w-[340px]"
        value={tab}
        onChange={setTab}
        options={[
          { id: "view", label: "View votes" },
          { id: "setup", label: "Voting setup" },
        ]}
      />

      {tab === "setup" ? (
        <section className="mt-[clamp(28px,4vw,36px)]">
          <div className="flex flex-wrap items-baseline gap-2.5 border-b border-line pb-[13px]">
            <h2 className="text-title font-semibold tracking-head">Poll</h2>
            <span
              className="status-chip"
              style={
                config.enabled
                  ? { background: "var(--ok-bg)", color: "var(--ok-fg)" }
                  : { background: hue("slate").bg, color: hue("slate").fg }
              }
            >
              {config.enabled ? "Open" : "Closed"}
            </span>
          </div>

          <div className="mt-4 text-ui font-medium">Voting method</div>
          <div className="mt-2.5 flex flex-wrap gap-[7px]" role="group" aria-label="Voting method">
            {(["SINGLE", "QUADRATIC"] as const).map((m) => {
              const on = choosingQuadratic ? m === "QUADRATIC" : config.method === m;
              const h = hue("brand");
              return (
                <button
                  key={m}
                  type="button"
                  aria-pressed={on}
                  disabled={config.methodLocked}
                  onClick={() => {
                    if (m === "SINGLE") {
                      setChoosingQuadratic(false);
                      if (config.method !== "SINGLE") void save({ method: "SINGLE" });
                    } else if (config.method !== "QUADRATIC") {
                      setChoosingQuadratic(true);
                    }
                  }}
                  className="pill disabled:cursor-not-allowed disabled:opacity-60"
                  style={on ? { background: h.bg, color: h.fg, borderColor: "transparent" } : undefined}
                >
                  {m === "QUADRATIC" ? "Quadratic" : "One vote per person"}
                </button>
              );
            })}
          </div>
          <p className="mt-2 max-w-[62ch] text-small leading-[1.55] text-muted">
            {(choosingQuadratic ? "QUADRATIC" : config.method) === "QUADRATIC"
              ? "Each voter holds a credit budget that you set, and buys weight on a project at weight squared credits. Backing one project with weight 3 costs 9; spreading 1 across three projects costs 3."
              : "Each voter may back a project once, for one unit of weight. The tally is a headcount. This is the default."}
          </p>
          {config.methodLocked ? (
            <p role="status" className="mt-2 max-w-[62ch] text-small leading-[1.55] text-muted">
              Locked: {config.lockReason}
            </p>
          ) : null}

          {choosingQuadratic || config.method === "QUADRATIC" ? (
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <label htmlFor="credit-budget" className="text-ui font-medium">
                Credits each voter receives
              </label>
              <input
                id="credit-budget"
                type="number"
                min={1}
                max={10000}
                disabled={config.methodLocked}
                {...(choosingQuadratic
                  ? { value: budgetDraft, onChange: (e: React.ChangeEvent<HTMLInputElement>) => setBudgetDraft(e.target.value), placeholder: "e.g. 100" }
                  : {
                      defaultValue: config.creditBudget,
                      onBlur: (e: React.FocusEvent<HTMLInputElement>) => {
                        const value = Number(e.target.value);
                        if (value !== config.creditBudget) void save({ creditBudget: value });
                      },
                    })}
                className="w-[110px] rounded-[10px] border border-line bg-surface px-3 py-2 font-mono text-small outline-none focus:border-muted disabled:opacity-60"
              />
              {choosingQuadratic ? (
                <button
                  type="button"
                  className="btn btn-sm"
                  disabled={!(Number(budgetDraft) >= 1)}
                  onClick={async () => {
                    await save({ method: "QUADRATIC", creditBudget: Number(budgetDraft) });
                    setChoosingQuadratic(false);
                    setBudgetDraft("");
                  }}
                >
                  Use quadratic voting
                </button>
              ) : null}
            </div>
          ) : null}

          <div className="mt-6 text-ui font-medium">Who can vote</div>
          <div className="mt-2.5 flex flex-wrap gap-[7px]">
            {(["AUTHENTICATED", "EMAIL_GATED", "OPEN_LINK"] as const).map((a) => {
              const on = config.access === a;
              const h = hue("brand");
              return (
                <button
                  key={a}
                  type="button"
                  onClick={() => void save({ access: a })}
                  className="pill"
                  style={on ? { background: h.bg, color: h.fg, borderColor: "transparent" } : undefined}
                >
                  {ACCESS_LABEL[a]}
                </button>
              );
            })}
          </div>
          <p className="mt-2 max-w-[62ch] text-small leading-[1.55] text-muted">
            {config.access === "AUTHENTICATED"
              ? "Voters are identified by their account. This is the strongest identity available."
              : config.access === "EMAIL_GATED"
                ? "Voters give an email address, which becomes their identity for duplicate detection."
                : "Anyone with the link may vote, identified only by a hashed client address. Weakest identity: lean on the rate limit."}
          </p>

          <div className="mt-6">
            {toggles.map((t) => {
              const on = Boolean(config[t.key]);
              return (
                <div key={t.key} className="flex items-center gap-5 border-b border-line py-[13px]">
                  <div className="min-w-0 flex-1">
                    <div className="text-ui">{t.label}</div>
                    <div className="text-small leading-[1.5] text-muted">{t.hint}</div>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={on}
                    onClick={() => void save({ [t.key]: !on } as Partial<VotingConfig>)}
                    className="relative h-6 w-[42px] flex-none rounded-full border p-0 [transition:background-color_420ms_cubic-bezier(0.33,1,0.68,1)_60ms,border-color_260ms]"
                    style={{
                      background: on ? "var(--ac)" : "var(--el)",
                      borderColor: on ? "var(--ac)" : "var(--ln)",
                    }}
                  >
                    <span
                      className="absolute top-[2px] h-[18px] w-[18px] rounded-full [transition:left_260ms_cubic-bezier(0.16,1,0.3,1)]"
                      style={{ left: on ? "21px" : "2px", background: on ? "var(--bg)" : "var(--mu)" }}
                    />
                  </button>
                </div>
              );
            })}
          </div>

          <p className="mt-4 max-w-[62ch] text-small leading-[1.55] text-muted">
            The voting window itself is the event's voting opens/closes dates, set in{" "}
            <Link href={`/events/${slug}/settings`} className="underline">
              event settings
            </Link>
            . Ballots outside that window are refused server-side and recorded as VOTE_REJECTED.
          </p>
        </section>
      ) : (
        <>
          <section className="mt-[clamp(28px,4vw,36px)]">
            <div className="border-b border-line pb-[13px]">
              <h2 className="text-title font-semibold tracking-head">Standings</h2>
              <p className="mt-1.5 text-small text-muted">
                {results
                  ? `${results.voters} voters, ${results.totalWeight} total weight${
                      results.hiddenUntilClose ? ", hidden from the public until voting closes" : ""
                    }.`
                  : "No tally yet."}
              </p>
            </div>
            {results?.standings.map((s) => (
              <div key={s.submissionId} className="flex items-center gap-3.5 border-b border-line py-[11px]">
                <span className="w-7 flex-none font-mono text-meta text-muted">#{s.rank}</span>
                <span className="min-w-0 flex-1 truncate text-ui">{s.submission?.name ?? "Unknown"}</span>
                <svg viewBox="0 0 140 6" preserveAspectRatio="none" className="block h-[6px] w-[140px] flex-none" role="img" aria-label="Vote share">
                  <rect x="0" y="0" width="140" height="6" rx="3" fill="var(--el)" />
                  <rect x="0" y="0" width={Math.round((s.weight / maxWeight) * 140)} height="6" rx="3" fill="var(--ac)" />
                </svg>
                <span className="w-[92px] flex-none text-right font-mono text-small text-muted">
                  {s.weight} · {s.voters} voters
                </span>
              </div>
            ))}
          </section>

          <section className="mt-[clamp(36px,5vw,48px)]">
            <div className="border-b border-line pb-[13px]">
              <h2 className="text-title font-semibold tracking-head">Ballots</h2>
              <p className="mt-1.5 text-small text-muted">Every vote cast, with who cast it. Organizer view only.</p>
            </div>
            <div className="mt-2 grid">
              {ballots.length === 0 ? (
                <div className="py-3 text-small text-muted">No ballots yet.</div>
              ) : (
                ballots.map((b) => (
                  <div key={b.id} className="flex items-center gap-3.5 border-b border-line py-2.5">
                    <span className="min-w-0 flex-1 truncate text-ui">{b.voter}</span>
                    <span className="min-w-0 flex-1 truncate text-small text-muted">{b.submission.name}</span>
                    {b.flag ? (
                      <span title={b.flag} className="status-chip flex-none bg-danger-soft text-danger">
                        flagged
                      </span>
                    ) : null}
                    <span className="flex-none font-mono text-small">
                      {b.weight} · {b.credits}c
                    </span>
                    <span className="flex-none font-mono text-meta text-muted">
                      {new Date(b.createdAt).toLocaleString()}
                    </span>
                  </div>
                ))
              )}
            </div>
          </section>

          <section className="mt-[clamp(36px,5vw,48px)]">
            <div className="border-b border-line pb-[13px]">
              <h2 className="text-title font-semibold tracking-head">Anti-abuse</h2>
              <p className="mt-1.5 text-small text-muted">
                {flagged} of {ballots.length} ballot lines flagged for review. Nothing is auto-rejected: you decide.
              </p>
            </div>
            <div className="mt-[18px] grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(220px,1fr))]">
              {[
                {
                  title: "Duplicate detection",
                  body: "One ballot line per voter per project, enforced by a unique database constraint rather than application code. Re-voting replaces the previous ballot.",
                },
                {
                  title: "Rate limiting",
                  body: "Ballots are limited per hashed client address in a fixed window, in process. No Redis, so the platform still runs with the network off.",
                },
                {
                  title: "Position bias",
                  body: "Ballot order is shuffled per voter with a deterministic seed, so a reload never reshuffles under the voter and no project sits at the top for everyone.",
                },
                {
                  title: "Self-voting",
                  body: "A signed-in voter cannot back their own team's project, checked against team membership on the server.",
                },
              ].map((c) => (
                <div key={c.title} className="rounded-[10px] border border-line px-4 py-3.5">
                  <div className="text-ui font-medium">{c.title}</div>
                  <p className="mt-1.5 text-small leading-[1.55] text-muted">{c.body}</p>
                </div>
              ))}
            </div>
            <p className="mt-4 text-small leading-[1.55] text-muted">
              Cast and rejected ballots are both written to the audit log as VOTE_CAST and VOTE_REJECTED, exportable
              from the dashboard as audit.csv.
            </p>
          </section>
        </>
      )}
    </main>
  );
}
