"use client";

import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ScreenSkeleton } from "@/components/layout/screen-skeleton";
import { ApiError, del, get, patch, post } from "@/lib/api";
import { hue, type HueName } from "@/lib/hues";
import type { EventDetail } from "@/lib/types";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Notice } from "@/components/ui/notice";
import { PageHeader } from "@/components/ui/page-header";
import { fromUtcInput, utcDateTime } from "@/lib/format";
import { can } from "@/lib/permissions";

type RoundKind = "QUIZ" | "SUBMISSION" | "SCORING" | "PITCH" | "VOTE" | "RESULT";

const KIND_HUE: Record<RoundKind, HueName> = {
  QUIZ: "neutral",
  SUBMISSION: "info",
  SCORING: "brand",
  PITCH: "neutral",
  VOTE: "brand",
  RESULT: "info",
};

interface Round {
  id: string;
  name: string;
  kind: RoundKind;
  description: string | null;
  position: number;
  opensAt: string | null;
  closesAt: string | null;
  advances: number | null;
}

type RoundState = "upcoming" | "live" | "closed";

function stateOf(round: Round, now: number): RoundState {
  const opens = round.opensAt ? new Date(round.opensAt).getTime() : null;
  const closes = round.closesAt ? new Date(round.closesAt).getTime() : null;
  if (closes !== null && closes < now) return "closed";
  if (opens !== null && opens > now) return "upcoming";
  return opens === null && closes === null ? "upcoming" : "live";
}

const STATE_HUE: Record<RoundState, HueName> = { upcoming: "info", live: "success", closed: "neutral" };

function roundWindow(round: Round): string {
  const fmt = (iso: string) => utcDateTime(iso, { month: "short", day: "numeric" });
  if (round.opensAt && round.closesAt) return `${fmt(round.opensAt)}-${fmt(round.closesAt)}`;
  if (round.closesAt) return `until ${fmt(round.closesAt)}`;
  if (round.opensAt) return `from ${fmt(round.opensAt)}`;
  return "not scheduled";
}

const FIELD =
  "rounded-[10px] border border-line-strong bg-surface px-3 py-2 text-ui text-text outline-none focus:border-muted";

export default function RoundsPage() {
  const params = useParams<{ slug: string }>();
  const slug = params.slug;

  const [event, setEvent] = useState<EventDetail | null>(null);
  const [rounds, setRounds] = useState<Round[]>([]);
  const [error, setError] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const [draft, setDraft] = useState({
    name: "",
    kind: "SCORING" as RoundKind,
    description: "",
    opensAt: "",
    closesAt: "",
    advances: "",
  });
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<{ action: "live" | "close" | "reopen"; round: Round } | null>(null);
  const [pendingBusy, setPendingBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [detail, list] = await Promise.all([
        get<EventDetail>(`/events/${slug}`),
        get<Round[]>(`/events/${slug}/rounds`),
      ]);
      setEvent(detail);
      setRounds(list);
      setNow(Date.now());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Rounds could not be loaded.");
    }
  }, [slug]);

  useEffect(() => {
    void load();
  }, [load]);

  async function addRound() {
    setBusy(true);
    setError("");
    try {
      await post(`/events/${slug}/rounds`, {
        name: draft.name.trim(),
        kind: draft.kind,
        description: draft.description.trim() || null,
        opensAt: fromUtcInput(draft.opensAt),
        closesAt: fromUtcInput(draft.closesAt),
        advances: draft.advances ? Number(draft.advances) : null,
      });
      setDraft({ name: "", kind: "SCORING", description: "", opensAt: "", closesAt: "", advances: "" });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "That round could not be added.");
    } finally {
      setBusy(false);
    }
  }

  async function makeLive(round: Round) {
    const at = Date.now();
    // A closed round keeps its old close date, which would now fall before the new opening.
    const ended = round.closesAt !== null && new Date(round.closesAt).getTime() <= at;
    try {
      await patch(`/events/${slug}/rounds/${round.id}`, {
        opensAt: new Date(at).toISOString(),
        ...(ended ? { closesAt: null } : {}),
      });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "That round could not be opened.");
    }
  }

  async function closeNow(round: Round) {
    try {
      await patch(`/events/${slug}/rounds/${round.id}`, { closesAt: new Date().toISOString() });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "That round could not be closed.");
    }
  }

  async function confirmPending() {
    if (!pending) return;
    setPendingBusy(true);
    const run = { live: makeLive, close: closeNow, reopen }[pending.action];
    await run(pending.round);
    setPendingBusy(false);
    setPending(null);
  }

  async function reopen(round: Round) {
    try {
      await patch(`/events/${slug}/rounds/${round.id}`, {
        closesAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "That round could not be reopened.");
    }
  }

  function exportCsv(rows: Array<{ round: Round; state: RoundState; entered: number; cleared: number | null }>) {
    const quote = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const lines = [
      ["position", "name", "kind", "opens_at", "closes_at", "state", "entered", "cleared"].join(","),
      ...rows.map(({ round, state, entered, cleared }, i) =>
        [
          String(i + 1),
          quote(round.name),
          round.kind,
          round.opensAt ?? "",
          round.closesAt ?? "",
          state,
          String(entered),
          cleared === null ? "" : String(cleared),
        ].join(","),
      ),
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${slug}-rounds.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function remove(round: Round) {
    try {
      await del(`/events/${slug}/rounds/${round.id}`);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "That round could not be deleted.");
    }
  }

  if (!event) {
    return (
      <main className="screen max-w-[1180px] pt-[clamp(26px,4vw,40px)]">
        {error ? (
          <h1 className="display text-page">{error}</h1>
        ) : (
          <ScreenSkeleton rows={3} />
        )}
      </main>
    );
  }

  const canEdit = can(event.viewer, "ROUNDS");
  const submissions = event._count?.submissions ?? 0;
  const teams = event._count?.teams ?? 0;
  const live = rounds.find((r) => stateOf(r, now) === "live");

  // Entered and cleared counts are only shown where the data actually says so:
  // the first round enters every team and clears on submission; later rounds
  // clear their configured advance count once closed.
  let carried = teams;
  const rows = rounds.map((round, index) => {
    const state = stateOf(round, now);
    const entered = index === 0 ? teams : carried;
    const cleared =
      index === 0
        ? submissions
        : state === "closed"
          ? Math.min(round.advances ?? entered, entered)
          : null;
    carried = cleared ?? entered;
    return { round, state, entered, cleared };
  });

  const nextUp = rows.find((r) => r.state === "upcoming") ?? null;
  const lastClosed = [...rows].reverse().find((r) => r.state === "closed") ?? null;
  const liveIndex = rows.findIndex((r) => r.state === "live");

  return (
    <main className="screen max-w-[1180px] pb-[120px] pt-[clamp(26px,4vw,40px)]">
      <PageHeader
        back={canEdit ? { href: `/events/${slug}/manage`, label: "Dashboard" } : undefined}
        eyebrow={`Rounds · ${event.name}`}
        title="Rounds"
        lead={
          <>
            {event.name} runs as a ladder: each round has its own gate, and only the entries that
            clear it move on.{" "}
            {live
              ? `Round ${liveIndex + 1} of ${rows.length} is live: ${live.name}, ${roundWindow(live)}.`
              : rounds.length
                ? "No round is live right now."
                : "No rounds scheduled yet."}
          </>
        }
        actions={
          <>
            <button type="button" onClick={() => exportCsv(rows)} className="btn btn-sm font-mono text-small">
              Export CSV
            </button>
            {canEdit && lastClosed ? (
              <button type="button" onClick={() => setPending({ action: "reopen", round: lastClosed.round })} className="btn btn-sm text-muted hover:text-text">
                Reopen previous
              </button>
            ) : null}
            {canEdit && nextUp ? (
              <button type="button" onClick={() => setPending({ action: "live", round: nextUp.round })} className="btn-primary btn-sm">
                Open {nextUp.round.name}
              </button>
            ) : null}
          </>
        }
      />

      {error ? (
        <Notice className="mt-5">{error}</Notice>
      ) : null}

      <div className="mt-[clamp(24px,3.4vw,34px)] grid gap-2.5">
        {rows.length === 0 ? (
          <p className="text-ui text-muted">
            This event has not published a round ladder. It runs as a single judging round.
          </p>
        ) : (
          rows.map(({ round, state, entered, cleared }, index) => {
            const st = hue(STATE_HUE[state]);
            const rate = cleared !== null && entered > 0 ? cleared / entered : null;
            return (
              <div
                key={round.id}
                className="flex flex-wrap items-start gap-y-3.5 gap-x-[22px] rounded-xl border bg-surface p-[clamp(15px,2.2vw,20px)] [transition:border-color_300ms]"
                style={{ borderColor: state === "live" ? "var(--ac)" : "var(--ln)" }}
              >
                <span className="mt-0.5 flex-none font-mono text-ui text-muted">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <div className="min-w-0 flex-[1_1_240px]">
                  <div className="flex flex-wrap items-baseline gap-[9px]">
                    <h2 className="text-title font-semibold tracking-head">{round.name}</h2>
                    <span
                      className="rounded-[5px] px-2 py-[3px] font-mono text-label uppercase tracking-stamp"
                      style={{ background: hue(KIND_HUE[round.kind] ?? "slate").bg, color: hue(KIND_HUE[round.kind] ?? "slate").fg }}
                    >
                      {round.kind.toLowerCase()}
                    </span>
                    <span className="font-mono text-meta text-muted">{roundWindow(round)}</span>
                  </div>
                  <p className="mt-2 max-w-[62ch] text-ui leading-[1.6] text-muted">
                    {round.description ?? "No gate described."}
                    {round.advances ? ` Top ${round.advances} advance.` : ""}
                  </p>
                  <div className="mt-3 flex max-w-[340px] items-center gap-2.5">
                    <svg viewBox="0 0 200 6" preserveAspectRatio="none" className="block h-[6px] w-full" role="img" aria-label="Clear rate">
                      <rect x="0" y="0" width="200" height="6" rx="3" fill="var(--el)" />
                      <rect
                        x="0"
                        y="0"
                        width={rate === null ? 0 : Math.round(rate * 200)}
                        height="6"
                        rx="3"
                        fill={st.fg}
                        className="[transition:width_420ms_cubic-bezier(0.33,1,0.68,1)_60ms]"
                      />
                    </svg>
                    <span className="whitespace-nowrap font-mono text-meta text-muted">
                      {rate === null ? "pending" : `${Math.round(rate * 100)}% cleared`}
                    </span>
                  </div>
                </div>
                <div className="flex flex-none flex-wrap gap-[22px]">
                  <div>
                    <div className="eyebrow">Entered</div>
                    <div className="mt-1.5 font-mono text-prose">{entered}</div>
                  </div>
                  <div>
                    <div className="eyebrow">Cleared</div>
                    <div className="mt-1.5 font-mono text-prose">{cleared ?? "-"}</div>
                  </div>
                </div>
                <div className="ml-auto flex flex-none items-center gap-[9px]">
                  <span
                    className="whitespace-nowrap rounded-md px-[9px] py-1 font-mono text-label uppercase tracking-stamp"
                    style={{ background: st.bg, color: st.fg }}
                  >
                    {state}
                  </span>
                  {canEdit && state !== "live" ? (
                    <button type="button" onClick={() => setPending({ action: "live", round })} className="btn btn-sm">
                      Make live
                    </button>
                  ) : null}
                  {canEdit && state === "live" ? (
                    <button
                      type="button"
                      onClick={() => setPending({ action: "close", round })}
                      className="btn btn-sm hover:border-danger hover:text-danger"
                    >
                      Close now
                    </button>
                  ) : null}
                  {canEdit && state === "upcoming" ? (
                    <button
                      type="button"
                      onClick={() => void remove(round)}
                      className="btn btn-sm text-muted hover:border-danger hover:text-danger"
                    >
                      Remove
                    </button>
                  ) : null}
                </div>
              </div>
            );
          })
        )}
      </div>

      {canEdit ? (
        <section className="card mt-8 p-5">
          <div className="eyebrow">Add a round</div>
          <div className="mt-3 grid gap-2.5 [grid-template-columns:repeat(auto-fit,minmax(180px,1fr))]">
            <input className={FIELD} placeholder="Round name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            <select
              className={FIELD}
              value={draft.kind}
              onChange={(e) => setDraft({ ...draft, kind: e.target.value as RoundKind })}
              aria-label="Kind"
            >
              {(Object.keys(KIND_HUE) as RoundKind[]).map((kind) => (
                <option key={kind} value={kind}>
                  {kind.toLowerCase()}
                </option>
              ))}
            </select>
            <input type="datetime-local" className={FIELD} value={draft.opensAt} onChange={(e) => setDraft({ ...draft, opensAt: e.target.value })} aria-label="Opens (UTC)" title="Opens, in UTC" />
            <input type="datetime-local" className={FIELD} value={draft.closesAt} onChange={(e) => setDraft({ ...draft, closesAt: e.target.value })} aria-label="Closes (UTC)" title="Closes, in UTC" />
            <input type="number" min={1} className={FIELD} placeholder="Advance (optional)" value={draft.advances} onChange={(e) => setDraft({ ...draft, advances: e.target.value })} />
          </div>
          <textarea
            className={`${FIELD} mt-2.5 min-h-[70px] w-full resize-y`}
            placeholder="What gate does this round apply?"
            value={draft.description}
            onChange={(e) => setDraft({ ...draft, description: e.target.value })}
          />
          <button type="button" onClick={() => void addRound()} disabled={busy || !draft.name.trim()} className="btn-primary mt-3 disabled:opacity-40">
            {busy ? "Adding..." : "Add round"}
          </button>
          <p className="mt-3 text-small leading-[1.55] text-muted">
            Rounds describe the schedule. What a judge may read still comes from their assignments,
            and submission deadlines are still enforced from the event timeline.
          </p>
        </section>
      ) : null}

      <ConfirmDialog
        open={pending !== null}
        title={
          pending
            ? pending.action === "close"
              ? `Close ${pending.round.name} now?`
              : pending.action === "reopen"
                ? `Reopen ${pending.round.name}?`
                : `Make ${pending.round.name} live now?`
            : ""
        }
        confirmLabel={pending?.action === "close" ? "Close round" : pending?.action === "reopen" ? "Reopen round" : "Make live"}
        tone={pending?.action === "close" ? "danger" : "primary"}
        busy={pendingBusy}
        onConfirm={() => void confirmPending()}
        onCancel={() => setPending(null)}
      >
        {pending ? (
          <>
            <p className="m-0">
              {pending.action === "close"
                ? "The round ends now and shows as closed on the ladder. You can reopen it later."
                : pending.action === "reopen"
                  ? "The round goes live again for the next 24 hours."
                  : pending.round.closesAt && new Date(pending.round.closesAt).getTime() > Date.now()
                    ? "The round opens now and keeps its scheduled close time."
                    : "The round opens now and stays live until you close it."}
            </p>
            <p className="m-0 mt-2">
              This changes the published schedule only. Submission and judging windows follow the dates in the event settings.
            </p>
          </>
        ) : null}
      </ConfirmDialog>
    </main>
  );
}
