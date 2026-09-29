"use client";

import { useEffect, useState } from "react";
import { ApiError, del, get, mediaUrl, post } from "@/lib/api";
import { hue, initials } from "@/lib/hues";
import { useSession } from "@/components/providers/session-provider";
import type { Comment, Submission } from "@/lib/types";
import { utcDateTime } from "@/lib/format";

/**
 * The gallery detail modal, opened from a submission card. Comments load
 * lazily once it opens, and everything server-side still gates on the
 * submission's own visibility (submitted-only for the public).
 */
export function GalleryModal({
  slug,
  submissionId,
  isEventAdmin,
  onClose,
}: {
  slug: string;
  submissionId: string;
  isEventAdmin: boolean;
  onClose: () => void;
}) {
  const { user } = useSession();
  const [entry, setEntry] = useState<Submission | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    get<Submission>(`/events/${slug}/submissions/${submissionId}`).then((data) => {
      if (!cancelled) setEntry(data);
    });
    get<Comment[]>(`/events/${slug}/submissions/${submissionId}/comments`).then((data) => {
      if (!cancelled) setComments(data);
    });
    return () => {
      cancelled = true;
    };
  }, [slug, submissionId]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function postComment() {
    if (!draft.trim()) return;
    setBusy(true);
    setError("");
    try {
      const created = await post<Comment>(`/events/${slug}/submissions/${submissionId}/comments`, {
        body: draft.trim(),
      });
      setComments((cs) => [...cs, created]);
      setDraft("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Your comment could not be posted.");
    } finally {
      setBusy(false);
    }
  }

  async function hideComment(commentId: string) {
    await post(`/events/${slug}/submissions/${submissionId}/comments/${commentId}/hide`, {});
    setComments((cs) =>
      cs.map((c) => (c.id === commentId ? { ...c, hiddenAt: new Date().toISOString() } : c)),
    );
  }

  async function removeComment(commentId: string) {
    await del(`/events/${slug}/submissions/${submissionId}/comments/${commentId}`);
    setComments((cs) => cs.filter((c) => c.id !== commentId));
  }

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-[60] grid place-items-center bg-black/50 p-6"
      style={{ animation: "fadein 220ms ease both" }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="max-h-[86dvh] w-full max-w-[560px] overflow-y-auto rounded-[14px] border border-line bg-surface"
        style={{ animation: "pop 320ms cubic-bezier(0.16,1,0.3,1) both" }}
      >
        <div
          className="w-full bg-elevated bg-cover bg-center"
          style={{
            aspectRatio: "16 / 9",
            borderRadius: "14px 14px 0 0",
            backgroundImage: entry?.thumbnailUrl ? `url(${mediaUrl(entry.thumbnailUrl)})` : undefined,
          }}
        />
        <div className="p-[clamp(18px,3vw,26px)]">
          {!entry ? (
            <div className="h-24 animate-pulse rounded-lg bg-elevated" />
          ) : (
            <>
              <div className="flex items-center justify-between gap-3">
                <h2 className="m-0 text-heading font-semibold tracking-head">{entry.name}</h2>
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Close"
                  className="border-0 bg-transparent p-1 text-heading leading-none text-muted transition-colors hover:text-text"
                >
                  ×
                </button>
              </div>
              <div className="mt-1.5 text-ui text-muted">
                {entry.track?.name ?? "No track"} · {entry.team.name}
              </div>
              {entry.tagline && <p className="mt-3.5 text-ui leading-[1.6]">{entry.tagline}</p>}
              {entry.description && (
                <p className="mt-2.5 whitespace-pre-line text-ui leading-[1.65] text-muted [text-wrap:pretty]">
                  {entry.description}
                </p>
              )}
              <div className="mt-5 flex flex-wrap gap-2.5 border-t border-line pt-4">
                {entry.liveUrl && (
                  <a
                    href={entry.liveUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn-primary btn-sm"
                  >
                    Live demo
                  </a>
                )}
                {entry.repoUrl && (
                  <a href={entry.repoUrl} target="_blank" rel="noopener noreferrer" className="btn btn-sm">
                    Repository
                  </a>
                )}
              </div>

              <div className="mt-[22px] border-t border-line pt-[18px]">
                <div className="eyebrow">Comments · {comments.length}</div>
                <div className="mt-3.5 grid gap-3.5">
                  {comments.map((c) => {
                    const avatar = hue(c.user.avatarHue);
                    const mine = user?.id === c.user.id;
                    return (
                      <div key={c.id} className="flex gap-2.5">
                        <span
                          className="grid h-[26px] w-[26px] flex-none place-items-center rounded-full font-mono text-label"
                          style={{ background: avatar.bg, color: avatar.fg }}
                        >
                          {initials(c.user.name)}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-baseline gap-2">
                            <span className="text-ui font-medium">{c.user.name}</span>
                            <span className="font-mono text-label text-muted">
                              {utcDateTime(c.createdAt)}
                            </span>
                            {c.hiddenAt && (
                              <span className="status-chip bg-danger-soft text-danger">hidden</span>
                            )}
                          </div>
                          <p className="mt-1 text-ui leading-[1.6] [text-wrap:pretty]">{c.body}</p>
                          <div className="mt-1 flex gap-2.5">
                            {(mine || isEventAdmin) && (
                              <button
                                type="button"
                                onClick={() => void removeComment(c.id)}
                                className="border-0 bg-transparent p-0 text-meta text-muted underline-offset-2 hover:text-text hover:underline"
                              >
                                Delete
                              </button>
                            )}
                            {isEventAdmin && !mine && !c.hiddenAt && (
                              <button
                                type="button"
                                onClick={() => void hideComment(c.id)}
                                className="border-0 bg-transparent p-0 text-meta text-muted underline-offset-2 hover:text-text hover:underline"
                              >
                                Hide
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  {comments.length === 0 && (
                    <p className="text-small text-muted">No comments yet.</p>
                  )}
                </div>
                {user ? (
                  <div className="mt-4 flex items-start gap-2">
                    <textarea
                      rows={2}
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      placeholder="Add a comment"
                      className="field flex-1 resize-y"
                    />
                    <button
                      type="button"
                      disabled={busy || !draft.trim()}
                      onClick={() => void postComment()}
                      className="btn-primary btn-sm flex-none disabled:opacity-40"
                    >
                      Post
                    </button>
                  </div>
                ) : (
                  <p className="mt-4 text-small text-muted">Sign in to leave a comment.</p>
                )}
                {error && <p className="mt-2 text-small text-danger">{error}</p>}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
