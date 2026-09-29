"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ApiError, del, get, patch, post } from "@/lib/api";
import { hue, type HueName } from "@/lib/hues";
import type { EventDetail } from "@/lib/types";
import { Notice } from "@/components/ui/notice";
import { utcDate, utcDateTime, utcTime } from "@/lib/format";

type UpdateTag = "ROUNDS" | "DEADLINE" | "JUDGING" | "LOGISTICS" | "VOTING";

const TAG_HUE: Record<UpdateTag, HueName> = {
  ROUNDS: "info",
  DEADLINE: "warning",
  JUDGING: "brand",
  LOGISTICS: "neutral",
  VOTING: "brand",
};

interface EventUpdate {
  id: string;
  title: string;
  body: string;
  pinned: boolean;
  tag: UpdateTag;
  read: boolean;
  createdAt: string;
  author: { id: string; name: string; org: string | null; avatarHue: string };
}

function when(iso: string): string {
  const d = new Date(iso);
  return `${utcDate(d, { month: "short", day: "numeric" })} · ${utcTime(d)}`;
}

export default function UpdatesPage() {
  const params = useParams<{ slug: string }>();
  const slug = params.slug;

  const [event, setEvent] = useState<EventDetail | null>(null);
  const [updates, setUpdates] = useState<EventUpdate[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [pinned, setPinned] = useState(false);
  const [tag, setTag] = useState<UpdateTag>("ROUNDS");

  const load = useCallback(async () => {
    try {
      const [detail, rows] = await Promise.all([
        get<EventDetail>(`/events/${slug}`),
        get<EventUpdate[]>(`/events/${slug}/updates`),
      ]);
      setEvent(detail);
      setUpdates(rows);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Updates could not be loaded.");
    }
  }, [slug]);

  useEffect(() => {
    void load();
  }, [load]);

  async function postUpdate() {
    setBusy(true);
    setError("");
    try {
      const created = await post<EventUpdate>(`/events/${slug}/updates`, {
        title: title.trim(),
        body: body.trim(),
        tag,
        pinned,
      });
      setTitle("");
      setBody("");
      setPinned(false);
      setOpen(created.id);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "That update could not be posted.");
    } finally {
      setBusy(false);
    }
  }

  async function openUpdate(update: EventUpdate) {
    const next = open === update.id ? null : update.id;
    setOpen(next);
    if (next && !update.read) {
      setUpdates((prev) => prev.map((u) => (u.id === update.id ? { ...u, read: true } : u)));
      await post(`/events/${slug}/updates/${update.id}/read`, {}).catch(() => undefined);
    }
  }

  async function markAllRead() {
    setUpdates((prev) => prev.map((u) => ({ ...u, read: true })));
    await post(`/events/${slug}/updates/read-all`, {}).catch(() => undefined);
  }

  async function togglePin(update: EventUpdate) {
    try {
      await patch(`/events/${slug}/updates/${update.id}`, { pinned: !update.pinned });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "That update could not be changed.");
    }
  }

  async function remove(update: EventUpdate) {
    try {
      await del(`/events/${slug}/updates/${update.id}`);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "That update could not be deleted.");
    }
  }

  if (!event) {
    return (
      <main className="screen max-w-[1180px] pt-[clamp(26px,4vw,40px)]">
        <div className="eyebrow">Updates</div>
        {error ? (
          <h1 className="display mt-3 text-page">{error}</h1>
        ) : (
          <div className="mt-6 h-28 rounded-xl bg-elevated" />
        )}
      </main>
    );
  }

  const canPost = event.viewer.isEventAdmin;
  const unread = updates.filter((u) => !u.read).length;

  return (
    <main className="screen max-w-[1180px] pb-[120px] pt-[clamp(26px,4vw,40px)]">
      {canPost ? (
        <Link href={`/events/${slug}/manage`} className="eyebrow mb-4 inline-flex items-center gap-[7px] hover:text-text">
          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M14 6l-6 6 6 6" />
          </svg>
          Dashboard
        </Link>
      ) : null}

      <div className="eyebrow">Updates · {event.name}</div>

      <div className="mt-3 flex flex-wrap items-end justify-between gap-y-[18px] gap-x-6">
        <div className="min-w-0 flex-[1_1_320px]">
          <h1 className="display text-page">Updates</h1>
          <p className="mt-3 max-w-[60ch] text-body leading-[1.6] text-muted">
            {unread > 0
              ? `${unread} update${unread === 1 ? "" : "s"} you have not opened. `
              : updates.length === 0
                ? "Nothing announced yet. "
                : "You are up to date. "}
            Everything organizers post about {event.name} lands here, newest first, pinned items on top.
          </p>
        </div>
        <div className="flex flex-none items-center gap-3.5">
        <svg viewBox="0 0 56 56" className="block h-[50px] w-[50px] flex-none" role="img" aria-label="A new update broadcasting to participants">
          <circle cx="28" cy="28" r="4.5" fill="var(--h4)" />
          <circle cx="28" cy="28" r="9" fill="none" stroke="var(--h1)" strokeWidth="1.5" opacity="0.55">
            <animate attributeName="r" values="9;24" dur="2.6s" repeatCount="indefinite" />
            <animate attributeName="opacity" values="0.55;0" dur="2.6s" repeatCount="indefinite" />
          </circle>
          <circle cx="28" cy="28" r="9" fill="none" stroke="var(--h2)" strokeWidth="1.5" opacity="0.55">
            <animate attributeName="r" values="9;24" dur="2.6s" begin="1.3s" repeatCount="indefinite" />
            <animate attributeName="opacity" values="0.55;0" dur="2.6s" begin="1.3s" repeatCount="indefinite" />
          </circle>
        </svg>
        {unread > 0 ? (
          <button type="button" onClick={() => void markAllRead()} className="btn btn-sm text-muted hover:text-text">
            Mark all read
          </button>
        ) : null}
        </div>
      </div>

      {error ? (
        <Notice className="mt-5">{error}</Notice>
      ) : null}

      <div className="mt-[clamp(24px,3.4vw,34px)] flex flex-wrap items-start gap-[clamp(18px,2.4vw,26px)]">
        <div className="grid min-w-0 flex-[3_1_420px] gap-2.5">
          {updates.length === 0 ? (
            <p className="text-ui text-muted">No updates yet.</p>
          ) : (
            updates.map((u) => {
              const isOpen = open === u.id;
              const chip = hue(TAG_HUE[u.tag] ?? "slate");
              return (
                <div
                  key={u.id}
                  className="overflow-hidden rounded-xl border bg-surface"
                  style={{ borderColor: !u.read ? "var(--ac)" : isOpen ? "var(--mu)" : "var(--ln)" }}
                >
                  <button
                    type="button"
                    onClick={() => void openUpdate(u)}
                    className="flex w-full flex-wrap items-baseline gap-y-2.5 gap-x-3.5 p-[clamp(15px,2.2vw,19px)] text-left [transition:background-color_420ms_cubic-bezier(0.33,1,0.68,1)_60ms] hover:bg-elevated"
                  >
                    <span
                      className="flex-none rounded-md px-[9px] py-1 font-mono text-label uppercase tracking-stamp"
                      style={{ background: chip.bg, color: chip.fg }}
                    >
                      {u.tag.toLowerCase()}
                    </span>
                    <span className="min-w-0 flex-[1_1_200px] text-body font-medium tracking-head">
                      {u.title}
                    </span>
                    <span className="ml-auto flex flex-none items-center gap-3">
                      {u.pinned ? (
                        <span className="font-mono text-label uppercase tracking-stamp text-accent">pinned</span>
                      ) : null}
                      {!u.read ? <span className="h-[7px] w-[7px] rounded-full bg-accent" /> : null}
                      <span className="font-mono text-label text-muted">{when(u.createdAt)}</span>
                    </span>
                  </button>
                  {isOpen ? (
                    <div className="px-[clamp(15px,2.2vw,19px)] pb-[clamp(16px,2.2vw,20px)]">
                      <p className="max-w-[68ch] whitespace-pre-wrap text-ui leading-[1.7] text-muted">{u.body}</p>
                      <div className="mt-3 flex flex-wrap items-center gap-3">
                        <span className="font-mono text-label text-muted">
                          {u.author.name}
                          {u.author.org ? ` · ${u.author.org}` : ""} · {utcDateTime(u.createdAt)}
                        </span>
                        {canPost ? (
                          <span className="ml-auto flex gap-2">
                            <button type="button" onClick={() => void togglePin(u)} className="btn btn-sm">
                              {u.pinned ? "Unpin" : "Pin"}
                            </button>
                            <button
                              type="button"
                              onClick={() => void remove(u)}
                              className="btn btn-sm hover:border-danger hover:text-danger"
                            >
                              Delete
                            </button>
                          </span>
                        ) : null}
                      </div>
                    </div>
                  ) : null}
                </div>
              );
            })
          )}
        </div>

        {canPost ? (
          <aside className="flex min-w-0 max-w-[380px] flex-[1_1_300px] flex-col gap-3 rounded-xl border border-line bg-surface p-[clamp(16px,2.2vw,20px)]">
            <div className="eyebrow">Post an update</div>
            <div className="font-mono text-label text-muted">
              Reaches everyone who can see {event.name}
            </div>
            <label className="block">
              <span className="mb-1.5 block text-small text-muted">Headline</span>
              <input
                className="w-full rounded-lg border border-line bg-elevated px-3 py-2.5 text-ui text-text outline-none focus:border-muted"
                placeholder="Scoring closes Sept 10 at 23:59 UTC"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-small text-muted">Detail</span>
              <textarea
                rows={5}
                className="w-full resize-y rounded-lg border border-line bg-elevated px-3 py-2.5 text-ui leading-[1.55] text-text outline-none focus:border-muted"
                placeholder="What changed, what participants need to do, and by when."
                value={body}
                onChange={(e) => setBody(e.target.value)}
              />
            </label>
            <div>
              <span className="mb-[7px] block text-small text-muted">Tag</span>
              <div className="flex flex-wrap gap-1.5">
                {(Object.keys(TAG_HUE) as UpdateTag[]).map((t) => {
                  const h = hue(TAG_HUE[t]);
                  const on = tag === t;
                  return (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setTag(t)}
                      className="pill"
                      style={on ? { background: h.bg, color: h.fg, borderColor: "transparent" } : undefined}
                    >
                      {t.charAt(0) + t.slice(1).toLowerCase()}
                    </button>
                  );
                })}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setPinned((v) => !v)}
              className="rounded-lg border border-line px-[13px] py-[9px] text-left text-small"
              style={pinned ? { background: "var(--acs)", color: "var(--act)" } : undefined}
            >
              {pinned ? "Pinned to the top of the feed" : "Pin to the top of the feed"}
            </button>
            <button
              type="button"
              onClick={() => void postUpdate()}
              disabled={busy || !title.trim() || !body.trim()}
              className="btn-primary disabled:opacity-40"
            >
              {busy ? "Publishing..." : "Publish to participants"}
            </button>
          </aside>
        ) : null}
      </div>
    </main>
  );
}
