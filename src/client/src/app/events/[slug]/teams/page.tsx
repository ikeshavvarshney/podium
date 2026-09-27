"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ScreenSkeleton } from "@/components/layout/screen-skeleton";
import { useSession } from "@/components/providers/session-provider";
import { ApiError, del, get, post } from "@/lib/api";
import { hue } from "@/lib/hues";
import type { EventDetail, Team } from "@/lib/types";
import { Notice } from "@/components/ui/notice";

interface TeamListing {
  kind: "TEAM";
  id: string;
  name: string;
  pitch: string | null;
  needs: string[];
  skills: string[];
  track: { id: string; name: string } | null;
  owner: string | null;
  seatsFilled: number;
}

interface SeekerListing {
  kind: "SEEKER";
  id: string;
  userId: string;
  name: string;
  org: string | null;
  pitch: string;
  skills: string[];
  track: { id: string; name: string } | null;
}

interface Board {
  maxTeamSize: number;
  teams: TeamListing[];
  seekers: SeekerListing[];
}

interface PendingRequest {
  id: string;
  direction: "ASK" | "INVITE";
  awaitingMe: boolean;
  team: { id: string; name: string };
  user: { id: string; name: string };
}

interface InviteResult {
  url: string;
}

const FIELD =
  "w-full rounded-[10px] border border-line-strong bg-elevated px-3 py-2.5 text-ui text-text outline-none focus:border-muted";

export default function TeamBoardPage() {
  const params = useParams<{ slug: string }>();
  const slug = params.slug;
  const { user } = useSession();

  const [event, setEvent] = useState<EventDetail | null>(null);
  const [board, setBoard] = useState<Board | null>(null);
  const [mine, setMine] = useState<Team | null>(null);
  const [requests, setRequests] = useState<PendingRequest[]>([]);
  const [kind, setKind] = useState<"all" | "teams" | "people">("all");
  const [track, setTrack] = useState<string>("all");
  const [draft, setDraft] = useState({ name: "", pitch: "", trackId: "", roles: "" });
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [invite, setInvite] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    try {
      const [detail, listings] = await Promise.all([
        get<EventDetail>(`/events/${slug}`),
        get<Board>(`/events/${slug}/board`),
      ]);
      setEvent(detail);
      setBoard(listings);
      if (user) {
        const [own, pending] = await Promise.all([
          get<Team | null>(`/events/${slug}/teams/mine`).catch(() => null),
          get<PendingRequest[]>(`/events/${slug}/board/requests/mine`).catch(() => []),
        ]);
        setMine(own);
        setRequests(pending);
        setDraft((d) => ({ ...d, name: d.name || own?.name || user.name }));
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "The team board could not be loaded.");
    }
  }, [slug, user]);

  useEffect(() => {
    void load();
  }, [load]);

  const listings = useMemo(() => {
    if (!board) return [];
    const all: Array<TeamListing | SeekerListing> = [
      ...(kind !== "people" ? board.teams : []),
      ...(kind !== "teams" ? board.seekers : []),
    ];
    return track === "all" ? all : all.filter((l) => l.track?.id === track);
  }, [board, kind, track]);

  const isOwner = Boolean(mine && user && mine.members.some((m) => m.userId === user.id && m.role === "OWNER"));

  async function run(action: () => Promise<unknown>, success: string) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
      setNotice(success);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "That did not go through.");
    } finally {
      setBusy(false);
    }
  }

  async function postToBoard() {
    const roles = draft.roles
      .split(",")
      .map((r) => r.trim())
      .filter(Boolean);
    await run(async () => {
      if (!mine && draft.name.trim() && draft.name.trim() !== user?.name) {
        // Naming a team means starting one; otherwise the listing is personal.
        await post(`/events/${slug}/teams`, { name: draft.name.trim(), lookingForMembers: true });
      }
      await post(`/events/${slug}/board/listing`, {
        pitch: draft.pitch.trim(),
        needs: roles,
        skills: roles,
        trackId: draft.trackId || null,
      });
    }, "Posted to the board.");
  }

  if (!event || !board) {
    return (
      <main className="screen max-w-[1400px] pt-[clamp(26px,4vw,40px)]">
        {error ? <h1 className="display text-page">{error}</h1> : <ScreenSkeleton rows={3} />}
      </main>
    );
  }

  const incoming = requests.filter((r) => r.awaitingMe);
  const outgoing = requests.filter((r) => !r.awaitingMe);
  const closed = Boolean(event.registrationClosesAt && new Date(event.registrationClosesAt).getTime() < Date.now());

  return (
    <main className="screen max-w-[1400px] pt-[clamp(26px,4vw,40px)]">
      <div className="eyebrow">team formation</div>
      <h1 className="display mt-3 text-page leading-[1.06]">Find a team</h1>
      <p className="mt-3 max-w-[62ch] text-body leading-[1.6] text-muted">
        Teams post what they still need; individuals post what they want to work on. Requests are
        private: nothing appears on either profile until both sides agree.
      </p>

      <div className="mt-[clamp(22px,3vw,30px)] flex flex-wrap items-center gap-x-[26px] gap-y-3">
        <div className="flex flex-wrap gap-[7px]">
          {(
            [
              ["all", "All"],
              ["teams", "Teams looking"],
              ["people", "People looking"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setKind(id)}
              className="pill"
              style={kind === id ? { background: hue("brand").bg, color: hue("brand").fg, borderColor: "transparent" } : undefined}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-[7px]">
          <button
            type="button"
            onClick={() => setTrack("all")}
            className="pill"
            style={track === "all" ? { background: hue("brand").bg, color: hue("brand").fg, borderColor: "transparent" } : undefined}
          >
            All
          </button>
          {event.tracks.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTrack(t.id)}
              className="pill"
              style={track === t.id ? { background: hue("brand").bg, color: hue("brand").fg, borderColor: "transparent" } : undefined}
            >
              {t.name}
            </button>
          ))}
        </div>
        <span className="ml-auto font-mono text-meta text-muted">
          {listings.length} open listing{listings.length === 1 ? "" : "s"}
        </span>
      </div>

      {error ? (
        <Notice className="mt-4">{error}</Notice>
      ) : null}
      {notice ? (
        <Notice tone="success" className="mt-4">{notice}</Notice>
      ) : null}

      <div className="mt-5 flex flex-wrap items-start gap-[clamp(18px,2.4vw,26px)]">
        <div className="grid min-w-0 flex-[3_1_520px] gap-3.5 [grid-template-columns:repeat(auto-fill,minmax(min(280px,100%),1fr))]">
          {listings.length === 0 ? (
            <div className="card col-span-full p-10 text-center text-ui text-muted">
              Nothing listed yet{track !== "all" ? " for that track" : ""}.
            </div>
          ) : (
            listings.map((l, i) => {
              const team = l.kind === "TEAM";
              const chip = hue(team ? "teal" : "plum");
              const already = sent.has(l.id);
              const ownTeam = team && mine?.id === l.id;
              const ownListing = !team && user?.id === (l as SeekerListing).userId;
              return (
                <article
                  key={`${l.kind}-${l.id}`}
                  className="card lift flex flex-col p-5"
                  style={{ animation: `pop 460ms cubic-bezier(0.16,1,0.3,1) ${i * 40}ms both` }}
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <span
                      className="rounded-md px-2 py-[3px] font-mono text-label uppercase tracking-stamp"
                      style={{ background: chip.bg, color: chip.fg }}
                    >
                      {team ? "team" : "looking for a team"}
                    </span>
                    <span className="font-mono text-meta text-muted">{l.track?.name ?? ""}</span>
                  </div>
                  <h2 className="mt-3 text-title font-semibold tracking-head">{l.name}</h2>
                  <p className="mt-2 text-ui leading-[1.6] text-muted">{l.pitch}</p>
                  <div className="mt-3 font-mono text-meta text-muted">
                    {team
                      ? `${(l as TeamListing).owner ?? "Owner"} · ${(l as TeamListing).seatsFilled} of ${board.maxTeamSize} seats filled`
                      : `${l.name} · Solo, open to any team`}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {(team ? (l as TeamListing).needs : []).map((n) => (
                      <span key={`n-${n}`} className="rounded-full border border-line bg-surface px-2.5 py-1 font-mono text-meta">
                        needs {n}
                      </span>
                    ))}
                    {!team ? (
                      <span className="rounded-full border border-line bg-surface px-2.5 py-1 font-mono text-meta">needs any team</span>
                    ) : null}
                    {l.skills.map((s) => (
                      <span key={`s-${s}`} className="rounded-full border border-line px-2.5 py-1 font-mono text-meta text-muted">
                        {s}
                      </span>
                    ))}
                  </div>
                  <div className="mt-auto pt-4">
                    {ownTeam || ownListing ? (
                      <div className="rounded-lg border border-dashed border-line py-2.5 text-center text-ui text-muted">
                        {ownTeam ? "Your team" : "Your listing"}
                      </div>
                    ) : team ? (
                      <button
                        type="button"
                        disabled={busy || !user || Boolean(mine) || already || closed}
                        title={!user ? "Sign in first" : mine ? "You are already on a team" : undefined}
                        onClick={() =>
                          void run(async () => {
                            await post(`/events/${slug}/board/requests`, { teamId: l.id });
                            setSent((prev) => new Set(prev).add(l.id));
                          }, `Request sent to ${l.name}. They decide; nothing changes until they accept.`)
                        }
                        className="btn w-full disabled:opacity-50"
                      >
                        {already ? "Request sent" : "Ask to join"}
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={busy || !isOwner || already || closed}
                        title={isOwner ? undefined : "Only a team owner can invite people"}
                        onClick={() =>
                          void run(async () => {
                            await post(`/events/${slug}/board/requests`, { userId: (l as SeekerListing).userId });
                            setSent((prev) => new Set(prev).add(l.id));
                          }, `Invite sent to ${l.name}.`)
                        }
                        className="btn w-full disabled:opacity-50"
                      >
                        {already ? "Invite sent" : "Invite to your team"}
                      </button>
                    )}
                  </div>
                </article>
              );
            })
          )}
        </div>

        <aside className="card flex min-w-0 max-w-[380px] flex-[1_1_300px] flex-col gap-3 p-5">
          <svg viewBox="0 0 240 46" className="block h-auto w-full" role="img" aria-label="A listing posted on the board reaches a matching teammate">
            <circle cx="20" cy="23" r="13" fill="var(--tone-brand-bg)" stroke="var(--tone-brand-fg)" strokeWidth="1.5" />
            <text x="20" y="27" textAnchor="middle" fill="var(--tone-brand-fg)" className="font-mono" style={{ fontSize: 9 }}>
              +
            </text>
            <path d="M36,23 H198" stroke="var(--ln)" strokeWidth="1.25" strokeDasharray="3 4" />
            <circle r="3.5" fill="var(--h2)">
              <animateMotion
                dur="3.2s"
                repeatCount="indefinite"
                path="M36,23 H198"
                keyPoints="0;0;1;1"
                keyTimes="0;0.06;0.58;1"
                calcMode="spline"
                keySplines="0 0 1 1;0.4 0 0.2 1;0 0 1 1"
              />
              <animate attributeName="opacity" values="0;1;1;0" keyTimes="0;0.06;0.9;1" dur="3.2s" repeatCount="indefinite" />
            </circle>
            <circle cx="220" cy="23" r="13" fill="none" stroke="var(--ln)" strokeWidth="1.5" />
            <path d="M214,23 l4,4 l8,-9" fill="none" stroke="var(--h4)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" opacity="0">
              <animate attributeName="opacity" values="0;0;1;1;0" keyTimes="0;0.62;0.7;0.94;1" dur="3.2s" repeatCount="indefinite" />
            </path>
          </svg>

          <div className="eyebrow">Post a listing</div>

          {!user ? (
            <p className="text-ui leading-[1.6] text-muted">
              <Link href={`/auth?next=/events/${slug}/teams`} className="underline">
                Sign in
              </Link>{" "}
              and register to post to the board.
            </p>
          ) : closed ? (
            <p className="text-ui leading-[1.6] text-muted">
              Registration has closed, so the board is read-only. Teams are fixed for judging.
            </p>
          ) : mine && !isOwner ? (
            <p className="text-ui leading-[1.6] text-muted">
              You are on {mine.name}. The team owner manages its listing.
            </p>
          ) : (
            <>
              <label className="grid gap-1.5">
                <span className="text-small text-muted">Team or your name</span>
                <input
                  className={FIELD}
                  value={draft.name}
                  disabled={Boolean(mine)}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                />
              </label>
              <label className="grid gap-1.5">
                <span className="text-small text-muted">What you are building, and who you need</span>
                <textarea
                  rows={3}
                  className={`${FIELD} resize-y leading-[1.55]`}
                  value={draft.pitch}
                  onChange={(e) => setDraft({ ...draft, pitch: e.target.value })}
                />
              </label>
              <label className="grid gap-1.5">
                <span className="text-small text-muted">Track</span>
                <select className={FIELD} value={draft.trackId} onChange={(e) => setDraft({ ...draft, trackId: e.target.value })}>
                  <option value="">Any track</option>
                  {event.tracks.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1.5">
                <span className="text-small text-muted">Roles you need, comma separated</span>
                <input
                  className={FIELD}
                  placeholder="frontend, evaluation"
                  value={draft.roles}
                  onChange={(e) => setDraft({ ...draft, roles: e.target.value })}
                />
              </label>
              <button
                type="button"
                onClick={() => void postToBoard()}
                disabled={busy || !draft.pitch.trim() || !event.viewer.isParticipant}
                title={event.viewer.isParticipant ? undefined : "Register for the event first"}
                className="btn-primary w-full disabled:opacity-40"
              >
                Post to the board
              </button>
            </>
          )}

          {incoming.length > 0 || outgoing.length > 0 ? (
            <div className="mt-2 border-t border-line pt-3">
              <div className="eyebrow">Requests</div>
              {incoming.map((r) => (
                <div key={r.id} className="mt-2.5 rounded-lg border border-line p-3">
                  <div className="text-ui">
                    {r.direction === "ASK" ? `${r.user.name} asks to join` : `${r.team.name} invites you`}
                  </div>
                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void run(() => post(`/events/${slug}/board/requests/${r.id}/accept`), "Accepted.")}
                      className="btn-primary btn-sm"
                    >
                      Accept
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void run(() => post(`/events/${slug}/board/requests/${r.id}/decline`), "Declined.")}
                      className="btn btn-sm"
                    >
                      Decline
                    </button>
                  </div>
                </div>
              ))}
              {outgoing.map((r) => (
                <div key={r.id} className="mt-2.5 flex items-center justify-between gap-2 font-mono text-meta text-muted">
                  <span>{r.direction === "ASK" ? `waiting on ${r.team.name}` : `waiting on ${r.user.name}`}</span>
                  <button
                    type="button"
                    onClick={() => void run(() => post(`/events/${slug}/board/requests/${r.id}/decline`), "Withdrawn.")}
                    className="hover:text-text"
                  >
                    withdraw
                  </button>
                </div>
              ))}
            </div>
          ) : null}

          {mine && isOwner && !closed ? (
            <div className="mt-2 border-t border-line pt-3">
              <div className="eyebrow">Invite link</div>
              <p className="mt-1.5 text-small leading-[1.5] text-muted">
                Or share a single-use link directly. It is shown once.
              </p>
              {invite ? (
                <code className="mt-2 block select-all break-all rounded-md border border-line bg-elevated px-2.5 py-2 font-mono text-meta">
                  {invite}
                </code>
              ) : null}
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      const created = await post<InviteResult>(`/events/${slug}/teams/${mine.id}/invites`, { maxUses: 1 });
                      setInvite(created.url);
                    }, "Invite link created.")
                  }
                  className="btn btn-sm"
                >
                  Create invite link
                </button>
                <Link href={`/events/${slug}/submit`} className="btn btn-sm">
                  Submission
                </Link>
              </div>
            </div>
          ) : null}

          {mine && user && !isOwner ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void run(() => del(`/events/${slug}/teams/${mine.id}/members/${user.id}`), "You left the team.")}
              className="btn btn-sm text-muted"
            >
              Leave {mine.name}
            </button>
          ) : null}
        </aside>
      </div>
    </main>
  );
}
