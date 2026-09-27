"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ScreenSkeleton } from "@/components/layout/screen-skeleton";
import { useSession } from "@/components/providers/session-provider";
import { ApiError, get } from "@/lib/api";
import { hue, STATUS_HUE, STATUS_LABEL, type HueName } from "@/lib/hues";
import { Notice } from "@/components/ui/notice";
import { StatusChip } from "@/components/ui/status-chip";
import { EmptyState } from "@/components/ui/empty-state";

interface ManagedEvent {
  id: string;
  slug: string;
  name: string;
  status: string;
  themeTags: string[];
  updatedAt: string;
  submissionsOpenAt: string | null;
  submissionDeadline: string | null;
  registrations: number;
  judges: number;
  submissions: number;
  progress: number;
}

const LIVE = new Set(["REGISTRATION_OPEN", "SUBMISSIONS_OPEN", "JUDGING", "VOTING"]);

function ago(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function dates(event: ManagedEvent): string {
  if (!event.submissionsOpenAt && !event.submissionDeadline) return "dates to be announced";
  const fmt = (iso: string) =>
    new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const start = event.submissionsOpenAt ?? event.submissionDeadline!;
  const end = event.submissionDeadline ?? event.submissionsOpenAt!;
  return `${fmt(start)}-${fmt(end)}, ${new Date(end).getFullYear()}`;
}

export default function OrganizerEventsPage() {
  const { user, loading } = useSession();
  const [events, setEvents] = useState<ManagedEvent[] | null>(null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!user) return;
    get<ManagedEvent[]>("/organizer/events")
      .then(setEvents)
      .catch((err: unknown) =>
        setError(err instanceof ApiError ? err.message : "Your events could not be loaded."),
      );
  }, [user]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!events || !q) return events ?? [];
    return events.filter(
      (e) =>
        e.name.toLowerCase().includes(q) ||
        (STATUS_LABEL[e.status] ?? e.status).toLowerCase().includes(q) ||
        e.themeTags.some((t) => t.toLowerCase().includes(q)),
    );
  }, [events, query]);

  if (loading || (user && !events && !error)) {
    return (
      <main className="screen max-w-[1400px]">
        <ScreenSkeleton rows={4} />
      </main>
    );
  }

  if (!user) {
    return (
      <main className="screen max-w-[1400px]">
        <div className="eyebrow">Organizer · events</div>
        <h1 className="display mt-3.5 text-hero">Sign in to see your events.</h1>
        <Link href="/auth?next=/organizer" className="btn-primary mt-8 inline-flex">
          Sign in
        </Link>
      </main>
    );
  }

  const list = events ?? [];
  const kpis: Array<{ label: string; value: number; hue: HueName }> = [
    { label: "Events", value: list.length, hue: "info" },
    { label: "Live now", value: list.filter((e) => LIVE.has(e.status)).length, hue: "success" },
    { label: "Registrations", value: list.reduce((s, e) => s + e.registrations, 0), hue: "brand" },
    { label: "Submissions", value: list.reduce((s, e) => s + e.submissions, 0), hue: "neutral" },
  ];

  return (
    <main className="screen max-w-[1400px]">
      <div className="flex flex-wrap items-end justify-between gap-5">
        <div className="min-w-0 flex-[1_1_320px]">
          <div className="eyebrow">Organizer · events</div>
          <h1 className="display mt-3.5 text-hero">My events</h1>
          <p className="mt-4 max-w-[60ch] text-body leading-[1.6] text-muted">
            Drafts stay private until you open registration. Pick an event to manage judging, or
            start a new one.
          </p>
        </div>
        {user.isOrganizer ? (
          <Link href="/events/new" className="btn-primary">
            + Create event
          </Link>
        ) : null}
      </div>

      <div className="mt-8 flex flex-wrap items-center gap-3">
        <input
          className="field max-w-[420px] flex-1"
          aria-label="Search my events"
          placeholder="Search my events by name, phase or track"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <span className="font-mono text-label uppercase tracking-label text-muted">
          {filtered.length} event{filtered.length === 1 ? "" : "s"}
        </span>
      </div>

      {error ? (
        <Notice className="mt-5">{error}</Notice>
      ) : null}

      <div className="mt-6 grid gap-2.5 [grid-template-columns:repeat(auto-fit,minmax(min(220px,100%),1fr))]">
        {kpis.map((k) => {
          const h = hue(k.hue);
          return (
            <div key={k.label} className="kpi" style={{ borderTopColor: h.fg }}>
              <div className="eyebrow">{k.label}</div>
              <div className="mt-2 text-figure font-medium tabular-nums tracking-display" style={{ color: h.fg }}>
                {k.value.toLocaleString()}
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-8 grid gap-3">
        {filtered.length === 0 ? (
          <EmptyState>
            {list.length === 0
              ? "You are not running any events yet."
              : "Nothing matches that search."}
          </EmptyState>
        ) : (
          filtered.map((event, i) => {
            const status = hue(STATUS_HUE[event.status] ?? "slate");
            const pct = Math.round(event.progress * 100);
            return (
              <article
                key={event.id}
                className="card lift flex flex-wrap items-center gap-x-8 gap-y-4 px-[22px] py-5"
                style={{ animation: `pop 460ms cubic-bezier(0.16,1,0.3,1) ${i * 40}ms both` }}
              >
                <div className="min-w-0 flex-[1_1_300px]">
                  <div className="flex flex-wrap items-baseline gap-2.5">
                    <h2 className="text-title font-semibold tracking-head">{event.name}</h2>
                    <StatusChip hue={status}>
                      {STATUS_LABEL[event.status] ?? event.status}
                    </StatusChip>
                  </div>
                  <div className="mt-1.5 font-mono text-meta text-muted">
                    {dates(event)} · Updated {ago(event.updatedAt)}
                  </div>
                  <div className="mt-3 flex max-w-[320px] items-center gap-2.5">
                    <span className="h-[7px] min-w-0 flex-1 overflow-hidden rounded-full bg-elevated">
                      <span
                        className="block h-full rounded-full [transition:width_520ms_cubic-bezier(0.16,1,0.3,1)]"
                        style={{ width: `${pct}%`, background: status.fg }}
                      />
                    </span>
                    <span className="font-mono text-label text-muted">{pct}%</span>
                  </div>
                </div>

                <div className="flex flex-wrap gap-x-8 gap-y-3">
                  {[
                    { label: "Registrations", value: event.registrations },
                    { label: "Submissions", value: event.submissions },
                    { label: "Judges", value: event.judges },
                  ].map((stat) => (
                    <div key={stat.label}>
                      <div className="eyebrow">{stat.label}</div>
                      <div className="mt-1.5 font-mono text-prose tabular-nums">
                        {stat.value.toLocaleString()}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="flex max-w-full flex-wrap gap-2">
                  <Link href={`/events/${event.slug}`} className="btn btn-sm">
                    Event page
                  </Link>
                  <Link href={`/events/${event.slug}/roles`} className="btn btn-sm">
                    Manage roles
                  </Link>
                  <Link href={`/events/${event.slug}/manage`} className="btn-primary btn-sm">
                    Dashboard
                  </Link>
                </div>
              </article>
            );
          })
        )}
      </div>
    </main>
  );
}
