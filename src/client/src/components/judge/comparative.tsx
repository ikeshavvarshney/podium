"use client";

import { useState } from "react";
import { coverHue, hue } from "@/lib/hues";
import type { BordaStandings, GroupsResponse } from "./types";

function Arrow({ up }: { up: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={up ? "M6 15l6-6 6 6" : "M6 9l6 6 6-6"} />
    </svg>
  );
}

/**
 * Comparative judging: put each small group in order from best to worst. The
 * standings below are this judge's own rankings only; the server never sends a
 * judge anyone else's.
 */
export function Comparative({
  groups,
  borda,
  groupIndex,
  order,
  onOrder,
  busy,
  error,
  locked,
  onConfirm,
  onRedo,
}: {
  groups: GroupsResponse;
  borda: BordaStandings | null;
  groupIndex: number;
  order: string[];
  onOrder: (next: string[]) => void;
  busy: boolean;
  error: string;
  locked: boolean;
  onConfirm: (skipped: boolean) => void;
  onRedo: () => void;
}) {
  const [note, setNote] = useState("");
  const group = groups.groups[groupIndex] ?? null;
  const byId = new Map((group?.submissions ?? []).map((sub) => [sub.id, sub]));
  const pct = groups.total === 0 ? 0 : Math.round((groups.completed / groups.total) * 100);
  const done = groups.total > 0 && groups.completed >= groups.total;
  const maxPoints = Math.max(1, ...(borda?.standings ?? []).map((r) => r.points));

  const move = (from: number, to: number) => {
    if (to < 0 || to >= order.length) return;
    const next = [...order];
    const [row] = next.splice(from, 1);
    next.splice(to, 0, row!);
    onOrder(next);
    setNote(`${byId.get(row!)?.name ?? "Project"} moved to position ${to + 1} of ${order.length}.`);
  };

  return (
    <main className="screen max-w-[1100px] pt-5">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line pb-3.5">
        <h1 className="m-0 flex items-center gap-2.5 font-display text-title font-[560] tracking-[-0.02em]">
          <i className="h-2 w-2 flex-none rounded-[2px]" style={{ background: "var(--k-blue)" }} aria-hidden="true" />
          Rank each group
        </h1>
        <div
          className="h-[6px] min-w-[120px] flex-[1_1_200px] overflow-hidden rounded-full bg-elevated"
          role="progressbar"
          aria-label="Groups ranked"
          aria-valuemin={0}
          aria-valuemax={groups.total}
          aria-valuenow={groups.completed}
        >
          <div
            className="h-full rounded-full [transition:width_700ms_cubic-bezier(0.22,1,0.36,1)]"
            style={{ width: `${pct}%`, background: "var(--k-blue)" }}
          />
        </div>
        <span className="font-mono text-small text-muted">
          {groups.completed} of {groups.total} groups ranked
        </span>
      </div>

      <p role="status" className="sr-only">
        {note}
      </p>

      {done ? (
        <div className="mt-6 rounded-[18px] border px-[clamp(20px,4vw,32px)] py-8" style={{ background: "var(--k-green-s)", borderColor: "var(--k-green)" }}>
          <span className="grid h-9 w-9 place-items-center rounded-full" style={{ background: "var(--sf)", color: "var(--k-green-t)", boxShadow: "var(--home-shadow)" }} aria-hidden="true">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12.5l4.5 4.5L19 7.5" />
            </svg>
          </span>
          <h2 className="m-0 mt-4 font-display text-heading font-[560] tracking-[-0.025em]">All groups ranked.</h2>
          <p className="mt-2.5 max-w-[54ch] text-body leading-[1.6] text-muted">
            A Borda count turns your finished rankings into one score per project: no absolute scores to calibrate across judges.
          </p>
          <button type="button" onClick={onRedo} disabled={locked} className="btn-primary mt-4 min-h-[44px] disabled:opacity-50">
            Redo rankings
          </button>
        </div>
      ) : group ? (
        <section aria-labelledby="group-title" className="mt-5">
          <h2 id="group-title" className="m-0 text-body font-semibold">
            Group {groupIndex + 1}: order these from best to worst
          </h2>
          <ol className="m-0 mt-3 grid list-none gap-2 p-0">
            {order.map((id, i) => {
              const sub = byId.get(id);
              if (!sub) return null;
              const h = hue(coverHue(sub.track?.name ?? "slate"));
              return (
                <li
                  key={id}
                  className="lift m-0 flex items-center gap-3 rounded-[14px] border border-line bg-surface px-3.5 py-3"
                  style={{ boxShadow: "var(--home-shadow)" }}
                >
                  <span
                    className="grid h-8 w-8 flex-none place-items-center rounded-full font-mono text-ui tabular-nums"
                    style={{ background: i === 0 ? "var(--k-violet-s)" : "var(--el)", color: i === 0 ? "var(--k-violet-t)" : "var(--mu)" }}
                    aria-hidden="true"
                  >
                    {i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                      <span className="min-w-0 text-title font-semibold tracking-[-0.02em] [overflow-wrap:anywhere]">{sub.name}</span>
                      <span className="chip uppercase tracking-stamp" style={{ background: h.bg, color: h.fg }}>
                        {sub.track?.name ?? "no track"}
                      </span>
                    </div>
                    <p className="m-0 mt-1 text-ui leading-[1.5] text-muted [overflow-wrap:anywhere]">{sub.tagline ?? sub.team.name}</p>
                  </div>
                  <div className="flex flex-none gap-1.5">
                    <button
                      type="button"
                      aria-label={`Move ${sub.name} up, currently ${i + 1} of ${order.length}`}
                      disabled={i === 0 || locked}
                      onClick={() => move(i, i - 1)}
                      className="btn grid h-11 w-11 place-items-center p-0 disabled:opacity-40"
                    >
                      <Arrow up />
                    </button>
                    <button
                      type="button"
                      aria-label={`Move ${sub.name} down, currently ${i + 1} of ${order.length}`}
                      disabled={i === order.length - 1 || locked}
                      onClick={() => move(i, i + 1)}
                      className="btn grid h-11 w-11 place-items-center p-0 disabled:opacity-40"
                    >
                      <Arrow up={false} />
                    </button>
                  </div>
                </li>
              );
            })}
          </ol>

          {error ? (
            <div role="alert" className="mt-3 rounded-[10px] bg-danger-soft px-3 py-2.5 text-ui text-danger">
              {error}
            </div>
          ) : null}

          <div className="mt-4 flex flex-wrap gap-2.5">
            <button type="button" disabled={busy || locked} onClick={() => onConfirm(false)} className="btn-primary min-h-[44px] disabled:opacity-50">
              {busy ? "Saving..." : "Confirm ranking, next group"}
            </button>
            <button type="button" disabled={busy || locked} onClick={() => onConfirm(true)} className="btn min-h-[44px] disabled:opacity-50">
              Skip this group
            </button>
          </div>
        </section>
      ) : (
        <p className="mt-6 text-body text-muted">Nothing to compare yet. Groups appear once the organizer has assigned you at least two projects.</p>
      )}

      <section aria-labelledby="standings-title" className="mt-9">
        <h2 id="standings-title" className="eyebrow m-0">
          Your rankings so far
        </h2>
        <ol className="m-0 mt-2.5 grid list-none p-0">
          {(borda?.standings ?? []).map((row) => (
            <li
              key={row.submissionId}
              className="relative m-0 flex items-center gap-3.5 overflow-hidden rounded-[10px] border-b border-line px-2 py-3 transition-colors duration-300 hover:bg-elevated"
            >
              <span
                aria-hidden="true"
                className="absolute inset-y-1 left-0 w-full origin-left rounded-[10px] opacity-[0.12] [transition:transform_900ms_cubic-bezier(0.22,1,0.36,1)]"
                style={{ background: "var(--k-violet)", transform: `scaleX(${Math.max(0.03, row.points / maxPoints)})` }}
              />
              <span className="relative w-5 flex-none font-mono text-small tabular-nums text-muted">{row.rank}</span>
              <span className="relative min-w-0 flex-1 truncate text-body font-medium">{row.submission?.name ?? "Unknown"}</span>
              <span className="relative flex-none font-mono text-meta text-muted">
                {row.points} pts, {row.firsts}/{row.appearances} firsts
              </span>
            </li>
          ))}
        </ol>
        {(borda?.standings ?? []).length === 0 ? <p className="text-ui text-muted">Nothing ranked yet. This fills in as you confirm groups.</p> : null}
        <p className="mt-3 max-w-[64ch] text-ui leading-[1.6] text-muted">
          In a group of k, first place scores k&minus;1 points, the next k&minus;2, down to 0. Points are normalized by the maximum a project could have scored, so appearing in fewer groups is not a penalty.
        </p>
      </section>
    </main>
  );
}
