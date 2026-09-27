"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ApiError, del, get, patch, post } from "@/lib/api";
import type { MyEventRow } from "@/lib/types";

interface Session {
  id: string;
  browser: string;
  os: string;
  ipHash: string | null;
  lastSeenAt: string;
  current: boolean;
}

interface Activity {
  id: string;
  summary: string;
  createdAt: string;
}

interface Prefs {
  judgingReminders: boolean;
  resultsPublished: boolean;
  voteDigest: boolean;
}

function stamp(iso: string): string {
  const d = new Date(iso);
  const sameDay = new Date().toDateString() === d.toDateString();
  return sameDay
    ? d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false })
    : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function ago(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 5) return "active now";
  if (mins < 60) return `last seen ${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `last seen ${hours} hour${hours === 1 ? "" : "s"} ago`;
  return `last seen ${new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
}

function Toggle({ on, onClick, label }: { on: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={onClick}
      className="relative h-6 w-[42px] flex-none rounded-full border p-0 [transition:background-color_420ms_cubic-bezier(0.33,1,0.68,1)_60ms,border-color_260ms] active:scale-95"
      style={{ background: on ? "var(--ac)" : "var(--el)", borderColor: on ? "var(--ac)" : "var(--ln)" }}
    >
      <span
        className="absolute top-[2px] h-[18px] w-[18px] rounded-full [transition:left_260ms_cubic-bezier(0.16,1,0.3,1)]"
        style={{ left: on ? "21px" : "2px", background: on ? "var(--bg)" : "var(--mu)" }}
      />
    </button>
  );
}

/** Notification preferences. Stored on the account and read by in-app notices. */
export function NotificationPrefs() {
  const [prefs, setPrefs] = useState<Prefs | null>(null);

  useEffect(() => {
    get<Prefs>("/auth/me/notifications").then(setPrefs).catch(() => setPrefs(null));
  }, []);

  if (!prefs) return null;

  const rows: Array<{ key: keyof Prefs; label: string; hint: string }> = [
    { key: "judgingReminders", label: "Judging reminders", hint: "A nudge when your queue is untouched and the window is closing." },
    { key: "resultsPublished", label: "Results published", hint: "One notice when standings go public." },
    { key: "voteDigest", label: "Community vote digest", hint: "A summary of votes cast on your submissions once voting closes." },
  ];

  return (
    <>
      <div className="eyebrow mt-[clamp(30px,5vw,42px)] tracking-label">Notifications</div>
      {rows.map((r) => (
        <div key={r.key} className="flex items-center gap-[18px] border-b border-line py-3.5">
          <div className="min-w-0 flex-1">
            <div className="text-ui">{r.label}</div>
            <div className="text-small leading-[1.5] text-muted">{r.hint}</div>
          </div>
          <Toggle
            on={prefs[r.key]}
            label={r.label}
            onClick={() => {
              const next = { ...prefs, [r.key]: !prefs[r.key] };
              setPrefs(next);
              void patch<Prefs>("/auth/me/notifications", { [r.key]: next[r.key] }).then(setPrefs);
            }}
          />
        </div>
      ))}
      <p className="mt-2.5 text-meta leading-[1.5] text-muted">
        Shown in the app on My events. This instance sends no email.
      </p>
    </>
  );
}

export function ProfilePanels({ events }: { events: MyEventRow[] }) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activity, setActivity] = useState<Activity[]>([]);
  const [stats, setStats] = useState<{ submitted: number; team: number; credits: number | null } | null>(null);
  const [history, setHistory] = useState<string[]>([]);
  const [hot, setHot] = useState<number | null>(null);
  const [error, setError] = useState("");

  const eventRow = events.find((row) => row.roles.includes("PARTICIPANT")) ?? null;
  const slug = eventRow?.event.slug ?? null;

  const load = useCallback(async () => {
    const [s, a] = await Promise.all([
      get<Session[]>("/auth/sessions").catch(() => []),
      get<Activity[]>("/auth/me/activity").catch(() => []),
    ]);
    setSessions(s);
    setActivity(a);

    if (!slug) return;
    const [team, mine, ballot, hist] = await Promise.all([
      get<{ members: unknown[] } | null>(`/events/${slug}/teams/mine`).catch(() => null),
      get<{ submission: { status: string } | null }>(`/events/${slug}/submissions/mine`).catch(() => null),
      get<{ creditBudget: number; creditsSpent: number; window: { open: boolean } }>(`/events/${slug}/voting/ballot`).catch(
        () => null,
      ),
      get<Array<{ createdAt: string }>>(`/events/${slug}/submissions/mine/history`).catch(() => []),
    ]);
    setStats({
      submitted: mine?.submission?.status === "SUBMITTED" ? 1 : 0,
      team: team?.members.length ?? 0,
      credits: ballot ? ballot.creditBudget - ballot.creditsSpent : null,
    });
    setHistory(hist.map((h) => h.createdAt));
  }, [slug]);

  useEffect(() => {
    void load();
  }, [load]);

  // Twelve hourly buckets, cumulative, ending now.
  const series = useMemo(() => {
    const now = Date.now();
    const counts = Array.from({ length: 12 }, () => 0);
    for (const at of history) {
      const hoursAgo = Math.floor((now - new Date(at).getTime()) / 3_600_000);
      if (hoursAgo >= 0 && hoursAgo < 12) counts[11 - hoursAgo]! += 1;
    }
    let running = 0;
    return counts.map((c) => (running += c));
  }, [history]);

  const max = Math.max(1, ...series);
  const points = series.map((v, i) => ({ x: 20 + i * 27.3, y: 88 - (v / max) * 70, v }));
  const line = points.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const area = `${line} L${points[11]!.x.toFixed(1)},92 L${points[0]!.x.toFixed(1)},92 Z`;

  async function revoke(id: string) {
    try {
      await del(`/auth/sessions/${id}`);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "That session could not be revoked.");
    }
  }

  async function revokeOthers() {
    try {
      await post("/auth/sessions/revoke", {});
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Sessions could not be revoked.");
    }
  }

  const tiles = stats
    ? [
        { value: String(stats.submitted), label: "Submitted projects", color: "var(--h1)" },
        { value: String(stats.team), label: "Team members", color: "var(--h3)" },
        { value: stats.credits === null ? "-" : String(stats.credits), label: "Voting credits left", color: "var(--h2)" },
      ]
    : null;

  return (
    <section className="min-w-0">
      {tiles ? (
        <>
          <div className="eyebrow tracking-label">This event · {eventRow?.event.name}</div>
          <div className="mt-3.5 flex flex-wrap gap-px overflow-hidden rounded-[10px] border border-line bg-line">
            {tiles.map((t) => (
              <div
                key={t.label}
                className="min-w-0 flex-[1_1_130px] border-t-[3px] bg-surface px-[18px] pb-[18px] pt-4 [transition:background-color_420ms_cubic-bezier(0.33,1,0.68,1)_60ms] hover:bg-elevated"
                style={{ borderTopColor: t.color }}
              >
                <div className="text-figure font-medium tabular-nums tracking-display" style={{ color: t.color }}>
                  {t.value}
                </div>
                <div className="mt-[5px] text-small leading-[1.45] text-muted">{t.label}</div>
              </div>
            ))}
          </div>

          <div className="card mt-[clamp(28px,5vw,38px)] px-[18px] pb-3.5 pt-4">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <span className="font-mono text-label uppercase tracking-label text-muted">
                Your draft edits, last 12 hours
              </span>
              <span className="font-mono text-label">
                {hot === null ? "hover a point" : `${series[hot]} edit${series[hot] === 1 ? "" : "s"} by ${11 - hot}h ago`}
              </span>
            </div>
            <svg viewBox="0 0 340 104" className="mt-2.5 block h-auto w-full" role="img" aria-label="Draft edits over the last twelve hours">
              <path d={area} fill="var(--ac)" fillOpacity="0.1" />
              <path d={line} fill="none" stroke="var(--ac)" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
              <line x1="12" y1="92" x2="330" y2="92" stroke="var(--ln)" />
              {points.map((p, i) => (
                <g key={i} onMouseEnter={() => setHot(i)} onMouseLeave={() => setHot(null)} className="cursor-pointer">
                  <rect x={p.x - 14} y="4" width="28" height="96" fill="transparent" />
                  <line x1={p.x} y1={p.y} x2={p.x} y2="92" stroke="var(--ac)" strokeOpacity={hot === i ? 0.5 : 0} style={{ transition: "stroke-opacity 200ms" }} />
                  <circle
                    cx={p.x}
                    cy={p.y}
                    r={hot === i ? 5 : 3.5}
                    fill={hot === i ? "var(--ac)" : "var(--sf)"}
                    stroke="var(--ac)"
                    strokeWidth="1.5"
                    className="[transition:r_420ms_cubic-bezier(0.33,1,0.68,1)_60ms,fill_200ms]"
                  />
                </g>
              ))}
            </svg>
          </div>
        </>
      ) : null}

      <div className={`flex items-baseline justify-between gap-3 ${tiles ? "mt-[clamp(30px,5vw,42px)]" : ""}`}>
        <div className="eyebrow tracking-label">Active sessions</div>
        <button type="button" onClick={() => void revokeOthers()} className="text-small text-muted transition-colors hover:text-text">
          Revoke all others
        </button>
      </div>
      {error ? <p className="mt-2 text-small text-danger">{error}</p> : null}
      {sessions.map((s) => (
        <div key={s.id} className="flex items-center gap-3 border-b border-line py-[13px]">
          <span
            className="h-1.5 w-1.5 flex-none rounded-full"
            style={{ background: s.current ? "var(--ac)" : "var(--ln)", transition: "background-color 220ms" }}
          />
          <div className="min-w-0 flex-1">
            <div className="truncate text-ui">{s.current ? "This browser" : `${s.browser}${s.os ? ` on ${s.os}` : ""}`}</div>
            <div className="mt-[3px] truncate font-mono text-label text-muted">
              {[s.browser, s.os, s.ipHash ? `ip ${s.ipHash}` : null, s.current ? null : ago(s.lastSeenAt)]
                .filter(Boolean)
                .join(" · ")}
            </div>
          </div>
          {s.current ? (
            <span className="flex-none px-0.5 py-1 font-mono text-label uppercase tracking-stamp text-accent">current</span>
          ) : (
            <button
              type="button"
              onClick={() => void revoke(s.id)}
              className="flex-none px-0.5 py-1 font-mono text-label uppercase tracking-stamp transition-colors hover:text-danger"
            >
              revoke
            </button>
          )}
        </div>
      ))}

      <div className="eyebrow mt-[clamp(30px,5vw,42px)] tracking-label">Recent activity</div>
      {activity.length === 0 ? (
        <p className="mt-3 text-small text-muted">Nothing recorded yet.</p>
      ) : (
        activity.map((a) => (
          <div
            key={a.id}
            className="-mx-2 grid gap-3.5 rounded-md border-b border-line px-2 py-3 [grid-template-columns:58px_minmax(0,1fr)] [transition:background-color_420ms_cubic-bezier(0.33,1,0.68,1)_60ms] hover:bg-elevated"
          >
            <span className="font-mono text-meta text-muted">{stamp(a.createdAt)}</span>
            <span className="text-ui leading-[1.55]">{a.summary}</span>
          </div>
        ))
      )}
    </section>
  );
}
