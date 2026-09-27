"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ApiError, get } from "@/lib/api";
import { hue } from "@/lib/hues";
import type { EventDetail } from "@/lib/types";

interface Standing {
  rank: number;
  rawRank: number;
  movement: number;
  ballotCount: number;
  rawMean?: number;
  normalizedValue?: number;
  submission: {
    id: string;
    name: string;
    tagline: string | null;
    team: { name: string };
    track: { name: string } | null;
  };
}

interface Results {
  method: string;
  comparative?: boolean;
  computedAt: string;
  ballotCount: number;
  standings: Standing[];
}

const PLACE = ["First place", "Second place", "Third place"];
const PODIUM_HUE = ["amber", "slate", "coral"];

function money(cents: number | null, currency: string): string {
  if (cents === null) return "Non-cash prize";
  return new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 0 }).format(
    cents / 100,
  );
}

export default function WinnersPage() {
  const params = useParams<{ slug: string }>();
  const slug = params.slug;

  const [event, setEvent] = useState<EventDetail | null>(null);
  const [results, setResults] = useState<Results | null>(null);
  const [tab, setTab] = useState<"overall" | "tracks" | "prizes">("overall");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const detail = await get<EventDetail>(`/events/${slug}`);
      setEvent(detail);
      try {
        setResults(await get<Results>(`/events/${slug}/results`));
      } catch (err) {
        setError(
          err instanceof ApiError ? err.message : "Results for this event are not available yet.",
        );
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "This event could not be loaded.");
    }
  }, [slug]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!event) {
    return (
      <main className="screen max-w-[1180px] pt-[clamp(26px,4vw,40px)]">
        <div className="eyebrow">Results</div>
        {error ? (
          <h1 className="display mt-3 text-page">{error}</h1>
        ) : (
          <div className="mt-6 h-28 rounded-xl bg-elevated" />
        )}
      </main>
    );
  }

  const standings = results?.standings ?? [];
  const podium = standings.slice(0, 3);
  const tracks = event.tracks
    .map((t) => ({
      track: t,
      winner: standings.find((s) => s.submission.track?.name === t.name) ?? null,
    }))
    .filter((row) => row.winner);

  return (
    <main className="screen max-w-[1180px] pb-[120px] pt-[clamp(26px,4vw,40px)]">
      <div className="flex flex-wrap items-start justify-between gap-5">
        <div className="min-w-0">
          <div className="eyebrow">Results · {event.name}</div>
          <h1 className="display mt-3 text-page">Winners</h1>
        </div>
        <svg viewBox="0 0 120 92" className="block h-auto w-[88px] flex-none" role="img" aria-label="Standings settling into place">
          <circle cx="60" cy="46" r="38" fill="none" stroke="var(--ln)" strokeDasharray="2 5" />
          <circle cx="60" cy="46" r="5" fill="var(--ac)" />
          {[
            { cx: 60, cy: 8, fill: "var(--h2)", begin: "0s" },
            { cx: 93, cy: 27, fill: "var(--h3)", begin: "0.6s" },
            { cx: 93, cy: 65, fill: "var(--h4)", begin: "1.2s" },
            { cx: 60, cy: 84, fill: "var(--h5)", begin: "1.8s" },
            { cx: 27, cy: 65, fill: "var(--h6)", begin: "2.4s" },
            { cx: 27, cy: 27, fill: "var(--h1)", begin: "3s" },
          ].map((d) => (
            <circle key={d.begin} cx={d.cx} cy={d.cy} r="4" fill={d.fill}>
              <animate attributeName="opacity" values="0.3;1;0.3" dur="3.6s" begin={d.begin} repeatCount="indefinite" />
            </circle>
          ))}
        </svg>
      </div>

      {!results ? (
        <div className="mt-5 max-w-[66ch] rounded-xl border border-dashed border-line p-[clamp(22px,3vw,32px)]">
          <p className="text-body leading-[1.7] text-muted">{error}</p>
          <p className="mt-3 text-ui leading-[1.65] text-muted">
            Standings appear here once judging closes and the organizer publishes a normalization run. Until then the
            server refuses to serve them, to anyone but an event admin.
          </p>
          <div className="mt-5 flex flex-wrap gap-2.5">
            <Link href={`/events/${slug}`} className="btn">
              Back to the event
            </Link>
          </div>
        </div>
      ) : (
        <>
          {!event.resultsPublished ? (
            <div className="mt-5 max-w-[66ch] rounded-xl border border-dashed border-line p-[clamp(18px,2.4vw,26px)]">
              <p className="text-ui leading-[1.7] text-muted">
                These results are not published yet, so only event admins can see this page. Provisional standings are
                computed from the ballots filed so far and will change as scoring completes.
              </p>
            </div>
          ) : null}

          <div className="mt-[clamp(24px,3.4vw,34px)] flex flex-wrap gap-y-1 gap-x-[22px] border-b border-line">
            {(
              [
                { id: "overall", label: "Overall" },
                { id: "tracks", label: "By track" },
                { id: "prizes", label: "Prizes" },
              ] as const
            ).map((t) => {
              const on = tab === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTab(t.id)}
                  className={`whitespace-nowrap border-b-2 px-0.5 py-2.5 text-ui transition-colors ${
                    on ? "border-accent text-text" : "border-transparent text-muted hover:text-text"
                  }`}
                >
                  {t.label}
                </button>
              );
            })}
          </div>

          {tab === "overall" ? (
            <>
              <div className="mt-[clamp(22px,3vw,30px)] grid gap-3.5 [grid-template-columns:repeat(auto-fit,minmax(min(280px,100%),1fr))]">
                {podium.map((s, i) => {
                  const h = hue(PODIUM_HUE[i] ?? "slate");
                  return (
                    <div key={s.submission.id} className="card flex flex-col gap-[11px] p-[clamp(18px,2.4vw,24px)]">
                      <div className="flex items-baseline justify-between gap-3">
                        <span
                          className="rounded-md px-[9px] py-1 font-mono text-label uppercase tracking-stamp"
                          style={{ background: h.bg, color: h.fg }}
                        >
                          #{s.rank} · {PLACE[i] ?? `Rank ${s.rank}`}
                        </span>
                        <span className="font-mono text-label text-muted">
                          {s.submission.track?.name ?? "No track"}
                        </span>
                      </div>
                      <h2 className="display text-page">{s.submission.name}</h2>
                      <p className="text-ui leading-[1.6] text-muted">{s.submission.tagline ?? ""}</p>
                      <div className="font-mono text-meta text-muted">{s.submission.team.name}</div>
                      <div className="mt-auto flex items-baseline justify-between gap-3 border-t border-line pt-2.5">
                        <span className="text-heading font-medium tracking-display">
                          {s.normalizedValue !== undefined ? (results.comparative ? `${Math.round(s.normalizedValue * 100)}%` : s.normalizedValue.toFixed(1)) : "-"}
                        </span>
                        <span className="font-mono text-label text-muted">
                          {results.comparative ? `${s.ballotCount} group${s.ballotCount === 1 ? "" : "s"}` : `${s.ballotCount} ballots · raw #${s.rawRank}`}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>

              {standings.length > 3 ? (
                <div className="mt-6 overflow-hidden rounded-xl border border-line bg-surface">
                  {standings.slice(3).map((s) => (
                    <div
                      key={s.submission.id}
                      className="flex flex-wrap items-center gap-y-2.5 gap-x-[18px] border-b border-line px-[clamp(15px,2vw,20px)] py-[15px]"
                    >
                      <span className="w-8 flex-none font-mono text-small text-muted">#{s.rank}</span>
                      <div className="min-w-0 flex-[1_1_180px]">
                        <div className="text-body font-medium tracking-head">{s.submission.name}</div>
                        <div className="mt-1 font-mono text-label text-muted">
                          {s.submission.team.name} · {s.submission.track?.name ?? "No track"}
                        </div>
                      </div>
                      {results.comparative ? null : (
                        <span className="flex-none font-mono text-meta text-muted">
                          {s.movement > 0 ? `+${s.movement}` : s.movement} vs raw
                        </span>
                      )}
                      <span className="min-w-[68px] flex-none text-right font-mono text-small">
                        {s.normalizedValue !== undefined ? (results.comparative ? `${Math.round(s.normalizedValue * 100)}%` : s.normalizedValue.toFixed(1)) : "-"}
                      </span>
                    </div>
                  ))}
                </div>
              ) : null}

              <p className="mt-5 max-w-[64ch] text-small leading-[1.65] text-muted">
                {results.comparative
                  ? `Ranked by Borda count over ${results.ballotCount} group rankings`
                  : `Ranked on the ${results.method === "ZSCORE" ? "per-judge z-score" : results.method === "RAW" ? "raw mean" : "rank-average"} of ${results.ballotCount} ballots`}, computed {new Date(results.computedAt).toLocaleString()}.{" "}
                <Link href={`/events/${slug}/results`} className="underline">
                  See the full working
                </Link>
                .
              </p>
            </>
          ) : null}

          {tab === "tracks" ? (
            <div className="mt-[clamp(22px,3vw,30px)] grid gap-3">
              {tracks.length === 0 ? (
                <p className="text-ui text-muted">This event has no tracks with ranked submissions.</p>
              ) : (
                tracks.map(({ track, winner }) => {
                  const s = winner!;
                  return (
                    <div key={track.id} className="card flex flex-wrap items-start gap-y-3.5 gap-x-[26px] p-[clamp(16px,2.2vw,22px)]">
                      <div className="min-w-0 flex-[1_1_260px]">
                        <div className="flex flex-wrap items-baseline gap-[9px]">
                          <span className="rounded-md bg-elevated px-[9px] py-1 font-mono text-label uppercase tracking-stamp text-muted">
                            {track.name}
                          </span>
                          <span className="text-title font-semibold tracking-head">Track winner</span>
                        </div>
                        <p className="mt-2 max-w-[58ch] text-ui leading-[1.6] text-muted">
                          {track.description ?? "Top ranked submission in this track."}
                        </p>
                      </div>
                      <div className="min-w-0 flex-[1_1_220px] border-t border-line pt-4 min-[520px]:border-l min-[520px]:border-t-0 min-[520px]:pl-5 min-[520px]:pt-0">
                        <div className="eyebrow">Winner</div>
                        <div className="mt-2 text-title font-semibold tracking-head">{s.submission.name}</div>
                        <div className="mt-[5px] font-mono text-meta text-muted">{s.submission.team.name}</div>
                        <p className="mt-2 text-ui leading-[1.6] text-muted">{s.submission.tagline ?? ""}</p>
                      </div>
                      <div className="flex-none text-right">
                        <div className="text-heading font-medium tracking-display">
                          {s.normalizedValue !== undefined ? s.normalizedValue.toFixed(1) : "-"}
                        </div>
                        <div className="mt-[5px] font-mono text-label text-muted">rank #{s.rank}</div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          ) : null}

          {tab === "prizes" ? (
            <div className="mt-[clamp(22px,3vw,30px)] max-w-[860px]">
              <p className="mb-[18px] max-w-[64ch] text-ui leading-[1.65] text-muted">
                Prizes are configured per event and are awarded by the organizer. podium records the standings; it does
                not decide who a discretionary prize goes to.
              </p>
              <div className="overflow-hidden rounded-xl border border-line bg-surface">
                {event.prizes.length === 0 ? (
                  <div className="p-5 text-ui text-muted">No prizes are configured for this event.</div>
                ) : (
                  event.prizes.map((p, i) => {
                    const s = standings[i];
                    return (
                      <div
                        key={p.id}
                        className="flex flex-wrap items-center gap-y-2.5 gap-x-[18px] border-b border-line px-[clamp(15px,2vw,20px)] py-[15px]"
                      >
                        <span className="flex-none font-mono text-small text-muted">{String(i + 1).padStart(2, "0")}</span>
                        <div className="min-w-0 flex-[1_1_180px]">
                          <div className="text-body font-medium tracking-head">{p.title}</div>
                          <div className="mt-1 font-mono text-label text-muted">
                            {p.track ? p.track.name : "All tracks"}
                            {s ? ` · leading: ${s.submission.name}` : ""}
                          </div>
                        </div>
                        <span className="min-w-[88px] flex-none text-right font-mono text-small">
                          {money(p.amountCents, p.currency)}
                        </span>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          ) : null}
        </>
      )}
    </main>
  );
}
