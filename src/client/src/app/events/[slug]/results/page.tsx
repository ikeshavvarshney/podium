"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { apiBase, ApiError, get, post } from "@/lib/api";
import { hue } from "@/lib/hues";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Notice } from "@/components/ui/notice";
import { Segmented } from "@/components/ui/segmented";

type Method = "RAW" | "ZSCORE" | "RANK_AVERAGE";

interface JudgeStat {
  judgeId: string;
  name: string;
  n: number;
  mean: number;
  sd: number;
  degenerate: boolean;
  lowSample?: boolean;
  shrunkMean?: number;
  shrunkSd?: number;
  tendency: string;
}

interface Standing {
  submissionId: string;
  name: string;
  team: string | null;
  track: string | null;
  rawMean: number;
  normalizedValue: number;
  display: number;
  rawRank: number;
  normalizedRank: number;
  rankDelta: number;
  ballotCount: number;
  contributions: Array<{ judgeId: string; total: number; normalized: number }>;
  lowSampleBallots?: number;
}

interface Integrity {
  lockstep: Array<{ judgeA: string; judgeB: string; shared: number; identical: number; correlation: number | null; meanGap: number }>;
  outliers: Array<{ judge: string; submission: string; deviation: number }>;
  flat: string[];
  conflicts: Array<{ judge: string; submission: string; org: string | null }>;
}

interface Preview {
  method: Method;
  comparative?: boolean;
  ballotCount: number;
  judgeStats: JudgeStat[];
  standings: Standing[];
  unranked: Array<{ submissionId: string; name: string }>;
}

const MODES: Array<{ id: Method; label: string; explainer: string }> = [
  {
    id: "RAW",
    label: "Raw",
    explainer:
      "The plain mean of every evaluation a project received. Easy to explain, and unfair to whoever drew the harsh panel.",
  },
  {
    id: "ZSCORE",
    label: "Per-judge z-score",
    explainer:
      "Each evaluation is standardized against the other evaluations that judge cast, correcting for both severity and spread. A judge with no spread contributes zero rather than distorting the ranking.",
  },
  {
    id: "RANK_AVERAGE",
    label: "Rank average",
    explainer:
      "Uses only the order each judge put projects in, discarding magnitude entirely. Robust to any quirk in how a judge uses the scale, but it cannot tell a narrow win from a landslide.",
  },
];

const METHOD_STEPS = [
  "Each judge scores every criterion; the server computes a weighted total from the stored rubric.",
  "For each judge, the mean and standard deviation of their own evaluations are computed.",
  "Every evaluation is restated as a distance from that judge's own mean, in their own units.",
  "A project's normalized score is the mean of the standardized evaluations it received.",
  "Projects are re-ranked on that score, and the movement against the raw rank is shown.",
];

export default function ResultsPage() {
  const params = useParams<{ slug: string }>();
  const slug = params.slug;

  const [method, setMethod] = useState<Method>("ZSCORE");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [published, setPublished] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [confirm, setConfirm] = useState<"publish" | "unpublish" | null>(null);
  const [understood, setUnderstood] = useState(false);
  const [byMethod, setByMethod] = useState<Partial<Record<Method, Preview>>>({});
  const [integrity, setIntegrity] = useState<Integrity | null>(null);

  useEffect(() => {
    get<Integrity>(`/events/${slug}/judging/integrity`).then(setIntegrity).catch(() => setIntegrity(null));
  }, [slug, published]);

  const load = useCallback(
    async (next: Method) => {
      setError("");
      try {
        const [data, event] = await Promise.all([
          get<Preview>(`/events/${slug}/results/preview?method=${next}`),
          get<{ resultsPublished: boolean }>(`/events/${slug}`),
        ]);
        setPreview(data);
        setPublished(event.resultsPublished);
      } catch (err) {
        setError(
          err instanceof ApiError ? err.message : "Could not load results for this event.",
        );
      }
    },
    [slug],
  );

  useEffect(() => {
    void load(method);
  }, [load, method]);

  // All three methods, once, so the page can say whether they agree with each other.
  useEffect(() => {
    let cancelled = false;
    Promise.all(
      MODES.map((m) =>
        get<Preview>(`/events/${slug}/results/preview?method=${m.id}`)
          .then((data) => [m.id, data] as const)
          .catch(() => null),
      ),
    ).then((rows) => {
      if (cancelled) return;
      const next: Partial<Record<Method, Preview>> = {};
      for (const row of rows) if (row) next[row[0]] = row[1];
      setByMethod(next);
    });
    return () => {
      cancelled = true;
    };
  }, [slug, published]);

  async function runAndPublish(publish: boolean) {
    setConfirm(null);
    setUnderstood(false);
    setBusy(true);
    setNotice("");
    try {
      if (publish) {
        await post(`/events/${slug}/results/normalize`, { method });
      }
      await post(`/events/${slug}/results/publish`, { publish });
      setPublished(publish);
      setNotice(
        publish
          ? "Standings published. The stored run is what the public now sees."
          : "Results withdrawn from public view.",
      );
      await load(method);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not change publication state.");
    } finally {
      setBusy(false);
    }
  }

  if (error && !preview) {
    return (
      <main className="screen max-w-[1400px]">
        <EmptyState
          tone="danger"
          action={
            <span className="inline-flex flex-wrap justify-center gap-2.5">
              <button type="button" className="btn" onClick={() => void load(method)}>
                Try again
              </button>
              <Link href={`/events/${slug}`} className="btn">
                Back to the event
              </Link>
            </span>
          }
        >
          {error}
        </EmptyState>
      </main>
    );
  }

  const active = MODES.find((m) => m.id === method)!;
  const normColLabel =
    method === "RAW" ? "raw" : method === "ZSCORE" ? "z-score" : "percentile";

  // Scatter bounds, so the plot stays readable whatever the score range is.
  const raws = preview?.standings.map((s) => s.rawMean) ?? [];
  const norms = preview?.standings.map((s) => s.display) ?? [];
  const rawMin = Math.min(...raws, 0);
  const rawMax = Math.max(...raws, 1);
  const normMin = Math.min(...norms, 0);
  const normMax = Math.max(...norms, 1);

  const idleJudges = preview?.judgeStats.filter((j) => j.n === 0) ?? [];
  const mostBallots = Math.max(0, ...(preview?.standings.map((r) => r.ballotCount) ?? [0]));
  const thin = preview?.standings.filter((r) => r.ballotCount < mostBallots) ?? [];
  const unranked = preview?.unranked ?? [];
  const incomplete = idleJudges.length > 0 || thin.length > 0 || unranked.length > 0;
  const judgesWithBallots = (preview?.judgeStats.length ?? 0) - idleJudges.length;

  // Where the three methods disagree by two places or more: the question worth asking before publishing.
  const rankIn = (m: Method, id: string) => byMethod[m]?.standings.find((r) => r.submissionId === id)?.normalizedRank;
  const disagreements = (byMethod.RAW?.standings ?? [])
    .map((r) => {
      const ranks = MODES.map((m) => rankIn(m.id, r.submissionId));
      const known = ranks.filter((x): x is number => x !== undefined);
      return { id: r.submissionId, name: r.name, ranks, spread: known.length ? Math.max(...known) - Math.min(...known) : 0 };
    })
    .filter((r) => r.spread >= 2)
    .sort((a, b) => b.spread - a.spread);
  const haveAll = MODES.every((m) => byMethod[m.id]);

  return (
    <main className="screen max-w-[1400px]">
      <Link
        href={`/events/${slug}/manage`}
        className="mb-4 inline-flex items-center gap-[7px] font-mono text-label uppercase tracking-label text-muted transition-colors hover:text-text"
      >
        <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M14 6l-6 6 6 6" />
        </svg>
        Manage event
      </Link>

      <div className="grid items-end gap-x-14 gap-y-10 [grid-template-columns:repeat(auto-fit,minmax(min(340px,100%),1fr))]">
        <div className="min-w-0">
          <div className="eyebrow tracking-label">
            Results · organizer only · {published ? "published" : "embargoed"}
          </div>
          <h1 className="display mt-[14px] text-hero">
            {preview?.comparative ? "Group rankings, combined by Borda count." : "Raw scores, then the same scores made comparable."}
          </h1>
        </div>

        <div className="grid min-w-0 gap-2.5">
          {preview?.comparative ? (
            <p className="m-0 text-small leading-[1.55] text-muted">
              Judges ordered small groups of projects and a Borda count combines the orders, scaled by the points each project could have earned. There is no per-judge score scale to standardize, so there is one method.
            </p>
          ) : (
            <>
              <Segmented
                label="Normalization method"
                value={method}
                onChange={setMethod}
                options={MODES.map((m) => ({ id: m.id, label: m.label }))}
              />
              <p className="m-0 text-small leading-[1.55] text-muted">{active.explainer}</p>
            </>
          )}
        </div>
      </div>

      {notice ? (
        <Notice tone="success" className="mt-6">
          {notice}
        </Notice>
      ) : null}
      {error ? <Notice className="mt-6">{error}</Notice> : null}

      <section className="mt-14">
        <div className="flex flex-wrap items-end justify-between gap-5 border-b border-line pb-3.5">
          <h2 className="m-0 text-heading font-semibold tracking-head">Standings</h2>
          <div className="flex flex-wrap gap-2.5">
            <a
              href={`${apiBase()}/api/events/${slug}/export/results.csv`}
              className="btn btn-sm font-mono text-meta"
            >
              Export results CSV
            </a>
            <a
              href={`${apiBase()}/api/events/${slug}/export/scores.csv`}
              className="btn btn-sm font-mono text-meta"
            >
              Export ballots CSV
            </a>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setUnderstood(false);
                setConfirm(published ? "unpublish" : "publish");
              }}
              className={`${published ? "btn" : "btn-primary"} btn-sm disabled:opacity-60`}
            >
              {busy ? "Working..." : published ? "Unpublish" : "Review and publish"}
            </button>
          </div>
        </div>

        <div className="overflow-x-auto" role="region" aria-label="Standings" tabIndex={0}>
          <table className="w-full min-w-[760px] border-collapse text-left">
            <caption className="sr-only">{preview?.comparative ? "Projects ranked by Borda count" : `Projects ranked under the ${active.label} method`}</caption>
            <thead>
              <tr className="border-b border-line font-mono text-label uppercase tracking-label text-muted">
                <th scope="col" className="w-[42px] py-3 font-normal">#</th>
                <th scope="col" className="py-3 font-normal">Project</th>
                <th scope="col" className="w-[110px] py-3 font-normal">Track</th>
                <th scope="col" className="w-[72px] py-3 text-right font-normal">{preview?.comparative ? "Points %" : "Raw"}</th>
                <th scope="col" className="w-[80px] py-3 text-right font-normal">{preview?.comparative ? "Borda" : normColLabel}</th>
                <th scope="col" className="w-[82px] py-3 text-right font-normal">Move</th>
                <th scope="col" className="w-[150px] py-3 text-right font-normal">{preview?.comparative ? "Groups" : "Evaluations"}</th>
              </tr>
            </thead>
            <tbody>
              {preview?.standings.map((row) => {
                const moveColor = row.rankDelta === 0 ? "var(--mu)" : row.rankDelta > 0 ? "var(--ok-fg)" : "var(--err)";
                return (
                  <tr key={row.submissionId} className="border-b border-line transition-colors hover:bg-elevated">
                    <td className="py-[13px] font-mono text-ui" style={{ color: row.normalizedRank === 1 ? "var(--ac)" : undefined }}>
                      {String(row.normalizedRank).padStart(2, "0")}
                    </td>
                    <td className="max-w-0 py-[13px] pr-3">
                      <div className="truncate text-ui">{row.name}</div>
                      <div className="truncate text-meta text-muted">
                        {row.team}
                        {method === "ZSCORE" && (row.lowSampleBallots ?? 0) > 0 ? (
                          <span title="Some evaluations come from judges with too few ballots to calibrate on their own; their scale is pulled toward the panel's." className="ml-1.5 text-warning-text">
                            · {row.lowSampleBallots} thin-judge evaluation{row.lowSampleBallots === 1 ? "" : "s"}
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td className="py-[13px] font-mono text-label uppercase tracking-stamp text-muted">{row.track ?? "-"}</td>
                    <td className="py-[13px] text-right font-mono text-ui text-muted">{row.rawMean.toFixed(1)}</td>
                    <td className="py-[13px] text-right font-mono text-ui">
                      {method === "RANK_AVERAGE" ? row.normalizedValue.toFixed(2) : row.display.toFixed(1)}
                    </td>
                    <td className="py-[13px] text-right font-mono text-small" style={{ color: moveColor }}>
                      {row.rankDelta === 0 ? "-" : `${row.rankDelta > 0 ? "up" : "down"} ${Math.abs(row.rankDelta)}`}
                    </td>
                    <td className="py-[13px]">
                      <div className="flex justify-end gap-[3px]">
                        {row.contributions.length === 0 ? (
                          <span className="rounded-[4px] bg-danger-soft px-[5px] py-0.5 font-mono text-label text-danger">none</span>
                        ) : (
                          row.contributions.map((c) => (
                            <span
                              key={c.judgeId}
                              title={`weighted total ${c.total}`}
                              className="rounded-[4px] bg-elevated px-[5px] py-0.5 font-mono text-label text-muted"
                            >
                              {c.total.toFixed(0)}
                            </span>
                          ))
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {preview && preview.unranked.length > 0 && (
          <p className="mt-4 text-small leading-[1.6] text-muted">
            Unranked, because no evaluation has been cast yet:{" "}
            {preview.unranked.map((u) => u.name).join(", ")}. These are never padded with a
            default score.
          </p>
        )}
      </section>

      {preview?.comparative ? null : (
        <>
      {integrity ? (
        <section aria-labelledby="integrity-title" className="mt-14">
          <div className="border-b border-line pb-3.5">
            <h2 id="integrity-title" className="m-0 text-heading font-semibold tracking-head">
              Panel integrity
            </h2>
            <p className="mt-1.5 text-ui text-muted">
              Questions worth asking before publishing. Nothing here changes a score.
            </p>
          </div>
          {integrity.lockstep.length + integrity.outliers.length + integrity.flat.length + integrity.conflicts.length === 0 ? (
            <p className="mt-3 text-ui text-muted">No judge pair scores in lockstep, no ballot sits far from its panel, and no conflicts of interest were found.</p>
          ) : (
            <ul className="m-0 mt-2 list-none p-0 text-ui">
              {integrity.conflicts.map((c) => (
                <li key={`c-${c.judge}-${c.submission}`} className="border-b border-line py-2.5">
                  <span className="font-medium">Possible conflict:</span> {c.judge} is assigned {c.submission}, whose team includes someone from {c.org}.
                </li>
              ))}
              {integrity.lockstep.map((p) => (
                <li key={`l-${p.judgeA}-${p.judgeB}`} className="border-b border-line py-2.5">
                  <span className="font-medium">In lockstep:</span> {p.judgeA} and {p.judgeB} shared {p.shared} projects
                  {p.identical === p.shared ? " and gave identical totals on every one" : ` (correlation ${p.correlation?.toFixed(2)})`}.
                </li>
              ))}
              {integrity.flat.map((name) => (
                <li key={`f-${name}`} className="border-b border-line py-2.5">
                  <span className="font-medium">Flat judge:</span> {name} gave every project the same score, so their ballots count as neutral.
                </li>
              ))}
              {integrity.outliers.slice(0, 8).map((o) => (
                <li key={`o-${o.judge}-${o.submission}`} className="border-b border-line py-2.5">
                  <span className="font-medium">Far from the panel:</span> {o.judge} on {o.submission}, {Math.abs(o.deviation).toFixed(1)} standard deviations{" "}
                  {o.deviation > 0 ? "above" : "below"} the other judges.
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      <section aria-labelledby="agree-title" className="mt-14">
        <div className="border-b border-line pb-3.5">
          <h2 id="agree-title" className="m-0 text-heading font-semibold tracking-head">
            Do the methods agree?
          </h2>
          <p className="mt-1.5 text-ui text-muted">Where raw, per-judge z-score and rank average put a project two places or more apart.</p>
        </div>
        {!haveAll ? (
          <p className="mt-3 text-ui text-muted">Comparing the three methods...</p>
        ) : disagreements.length === 0 ? (
          <p className="mt-3 max-w-[64ch] text-ui leading-[1.6]">
            All three methods agree on every project&apos;s rank to within one place, so the choice of method does not change who wins here.
          </p>
        ) : (
          <div className="overflow-x-auto" role="region" aria-label="Where the methods disagree" tabIndex={0}>
            <table className="mt-2 w-full min-w-[420px] border-collapse text-left">
              <caption className="sr-only">Rank of each project under each method</caption>
              <thead>
                <tr className="font-mono text-label uppercase tracking-label text-muted">
                  <th scope="col" className="py-2 font-normal">Project</th>
                  {MODES.map((m) => (
                    <th key={m.id} scope="col" className="w-[110px] py-2 text-right font-normal">
                      {m.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {disagreements.slice(0, 8).map((row) => (
                  <tr key={row.id} className="border-t border-line">
                    <td className="max-w-0 truncate py-2.5 pr-3 text-ui">{row.name}</td>
                    {row.ranks.map((r, i) => (
                      <td key={MODES[i]!.id} className="py-2.5 text-right font-mono text-ui tabular-nums">
                        {r ?? "-"}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="mt-[72px] grid items-start gap-x-12 gap-y-11 [grid-template-columns:repeat(auto-fit,minmax(min(340px,100%),1fr))]">
        <div>
          <div className="border-b border-line pb-3.5">
            <h2 className="m-0 text-heading font-semibold tracking-head">
              Per-judge calibration
            </h2>
            <p className="mt-1.5 text-ui text-muted">
              Mean and spread of each judge&apos;s evaluations, before standardizing.
            </p>
          </div>

          {preview?.judgeStats.map((stat) => {
            const tagHue =
              stat.n === 0
                ? "rose"
                : stat.tendency === "harsh"
                  ? "blue"
                  : stat.tendency === "generous"
                    ? "amber"
                    : "slate";
            const tag = hue(tagHue);
            return (
              <div
                key={stat.judgeId}
                className="-mx-2 grid items-center gap-3.5 rounded-[5px] border-b border-line px-2 py-[13px] transition-colors hover:bg-elevated [grid-template-columns:minmax(0,1fr)_58px_54px_96px]"
              >
                <div className="min-w-0">
                  <div className="truncate text-ui">{stat.name}</div>
                  <div className="text-meta text-muted">
                    {stat.n} evaluation{stat.n === 1 ? "" : "s"}
                    {stat.degenerate && stat.n > 1 ? " · no spread" : ""}
                    {stat.lowSample && stat.n > 0 ? " · low sample, shrunk toward panel" : ""}
                  </div>
                </div>
                <span className="text-right font-mono text-ui">{stat.mean.toFixed(1)}</span>
                <span className="text-right font-mono text-small text-muted">
                  {stat.n > 1 ? stat.sd.toFixed(2) : "-"}
                </span>
                <span
                  className="justify-self-end rounded-[4px] px-[7px] py-[3px] font-mono text-label uppercase tracking-stamp"
                  style={{ background: tag.bg, color: tag.fg }}
                >
                  {stat.tendency}
                </span>
              </div>
            );
          })}

          <div className="grid gap-3.5 pt-2.5 font-mono text-label uppercase tracking-stamp text-muted [grid-template-columns:minmax(0,1fr)_58px_54px_96px]">
            <span />
            <span className="text-right">mean</span>
            <span className="text-right">sd</span>
            <span className="text-right">bias</span>
          </div>
        </div>

        <div className="card p-[clamp(20px,3vw,28px)]">
          <div className="eyebrow">Raw against normalized</div>
          <svg
            viewBox="0 0 300 192"
            className="mt-4 block h-auto w-full"
            role="img"
            aria-label="Scatter of each project's raw score against its normalized score"
          >
            <line x1="34" y1="176" x2="292" y2="176" stroke="var(--ln)" />
            <line x1="34" y1="12" x2="34" y2="176" stroke="var(--ln)" />
            <line
              x1="34"
              y1="176"
              x2="286"
              y2="18"
              stroke="var(--mu)"
              strokeDasharray="3 5"
              strokeOpacity="0.35"
            />
            {preview?.standings.map((row) => {
              const x = 34 + ((row.rawMean - rawMin) / (rawMax - rawMin || 1)) * 252;
              const y = 176 - ((row.display - normMin) / (normMax - normMin || 1)) * 158;
              return (
                <circle
                  key={row.submissionId}
                  cx={x}
                  cy={y}
                  r="5"
                  fill="var(--ac)"
                  fillOpacity="0.55"
                  stroke="var(--ac)"
                  strokeWidth="1.5"
                >
                  <title>{`${row.name}: raw ${row.rawMean.toFixed(1)}, normalized ${row.display.toFixed(1)}`}</title>
                </circle>
              );
            })}
          </svg>
          <div className="mt-3.5 flex flex-wrap justify-between gap-3 border-t border-line pt-3.5 font-mono text-label tracking-stamp text-muted">
            <span>raw &rarr;</span>
            <span>points off the dashed line moved rank</span>
            <span>&uarr; normalized</span>
          </div>
        </div>

        <div className="card px-[30px] py-8">
          <div className="eyebrow">Documented method</div>
          <h3 className="display mt-3.5 text-heading leading-[1.15] tracking-head">
            How a rank moves
          </h3>
          <ol className="mt-[18px] list-decimal pl-5 text-ui leading-[1.75]">
            {METHOD_STEPS.map((step) => (
              <li key={step} className="mb-2">
                {step}
              </li>
            ))}
          </ol>
          <div className="mt-[22px] rounded-[10px] border border-line bg-elevated px-4 py-3.5 font-mono text-small leading-[1.8]">
            z = (x &minus; &mu;<sub>j</sub>) / &sigma;<sub>j</sub>
            <br />
            display = 50 + 10z
          </div>
          <p className="mt-4 text-small leading-[1.6] text-muted">
            A judge whose evaluations have no spread leaves the standard deviation undefined.
            Those evaluations contribute zero rather than being treated as extreme, and the ballot
            count is shown next to every standing so thin coverage stays visible.
          </p>
        </div>
      </section>
        </>
      )}

      <ConfirmDialog
        open={confirm === "publish"}
        title="Publish these standings?"
        confirmLabel="Run and publish standings"
        confirmDisabled={incomplete && !understood}
        busy={busy}
        onConfirm={() => void runAndPublish(true)}
        onCancel={() => setConfirm(null)}
      >
        <p className="m-0">
          This runs the <span className="font-medium text-text">{active.label}</span> normalization on {preview?.ballotCount ?? 0} evaluation
          {preview?.ballotCount === 1 ? "" : "s"} from {judgesWithBallots} judge{judgesWithBallots === 1 ? "" : "s"}, then makes the standings public and freezes every ballot. You can withdraw them afterwards, but anyone who has seen them has seen them.
        </p>
        {incomplete ? (
          <div className="mt-3 rounded-[10px] bg-warning-soft px-3.5 py-3 text-small text-warning-text">
            <p className="m-0 font-medium">The panel is not finished:</p>
            <ul className="m-0 mt-1.5 list-disc pl-5">
              {idleJudges.length > 0 ? (
                <li>
                  {idleJudges.length} judge{idleJudges.length === 1 ? " has" : "s have"} no evaluations ({idleJudges.map((j) => j.name).join(", ")}).
                </li>
              ) : null}
              {thin.length > 0 ? (
                <li>
                  {thin.length} project{thin.length === 1 ? " has" : "s have"} fewer evaluations than the most reviewed ({mostBallots}).
                </li>
              ) : null}
              {unranked.length > 0 ? (
                <li>
                  {unranked.length} project{unranked.length === 1 ? " is" : "s are"} unranked: {unranked.map((u) => u.name).join(", ")}.
                </li>
              ) : null}
            </ul>
            <label className="mt-3 flex cursor-pointer items-start gap-2.5 text-text">
              <input type="checkbox" checked={understood} onChange={(e) => setUnderstood(e.target.checked)} className="mt-[3px] h-[18px] w-[18px] flex-none accent-action" />
              <span>I understand the standings will be public with these gaps.</span>
            </label>
          </div>
        ) : (
          <p className="m-0 mt-3 text-small">Every project has the same number of evaluations and every judge has scored.</p>
        )}
      </ConfirmDialog>

      <ConfirmDialog
        open={confirm === "unpublish"}
        title="Withdraw the standings?"
        confirmLabel="Withdraw from public view"
        tone="danger"
        busy={busy}
        onConfirm={() => void runAndPublish(false)}
        onCancel={() => setConfirm(null)}
      >
        <p className="m-0">The public standings and the winners page will disappear. The stored normalization run is kept, judges can change their ballots again, and you can publish again later.</p>
      </ConfirmDialog>
    </main>
  );
}
