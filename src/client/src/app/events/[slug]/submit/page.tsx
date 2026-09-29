"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { ScreenSkeleton } from "@/components/layout/screen-skeleton";
import { PreviewImage } from "@/components/submission/preview-image";
import { EmptyState } from "@/components/ui/empty-state";
import { ApiError, get, patch, post, uploadImage } from "@/lib/api";
import { coverHue, hue, initials } from "@/lib/hues";
import { formatDeadline, timeLeft } from "@/lib/participant-step";
import type {
  Challenge,
  CustomQuestion,
  DeadlineWindow,
  Submission,
  Team,
  Track,
} from "@/lib/types";
import { isHttpUrl, normalizeUrl } from "@/lib/url";
import { useNow } from "@/lib/use-now";
import { utcDateTime, utcTime } from "@/lib/format";

interface HistoryEntry {
  id: string;
  action: string;
  summary: string;
  createdAt: string;
}

interface MineResponse {
  submission: Submission | null;
  window: DeadlineWindow;
}

const LICENCES = ["MIT", "Apache-2.0", "AGPL-3.0", "Proprietary"];
const MAX_TAGS = 20;
const MAX_IMAGES = 8;
const TAGLINE_MAX = 90;
const AUTOSAVE_MS = 3000;

const URL_KEYS = ["repoUrl", "liveUrl", "videoUrl", "thumbnailUrl"] as const;
type UrlKey = (typeof URL_KEYS)[number];

const FIELD_LABEL: Record<string, string> = {
  name: "Project name",
  tagline: "Tagline",
  description: "Description",
  repoUrl: "Repository",
  liveUrl: "Live deployment",
  videoUrl: "Demo recording",
  thumbnailUrl: "Thumbnail image",
  techTags: "Tags",
  images: "Images",
};

const DECLARATIONS: Array<{ id: string; label: string; hint: string }> = [
  {
    id: "window",
    label: "Built during the event window",
    hint: "All substantive work happened inside the event's build period.",
  },
  {
    id: "original",
    label: "Original work, dependencies credited",
    hint: "Third-party code is declared in the repository.",
  },
  {
    id: "licence",
    label: "Licence declared and correct",
    hint: "The licence above matches what is in the repository.",
  },
];

interface Draft {
  name: string;
  tagline: string;
  description: string;
  repoUrl: string;
  liveUrl: string;
  videoUrl: string;
  thumbnailUrl: string;
  license: string;
  trackId: string;
  techTags: string[];
  challengeIds: string[];
  declarations: Record<string, boolean>;
  answers: Record<string, string>;
}

const emptyDraft: Draft = {
  name: "",
  tagline: "",
  description: "",
  repoUrl: "",
  liveUrl: "",
  videoUrl: "",
  thumbnailUrl: "",
  license: "MIT",
  trackId: "",
  techTags: [],
  challengeIds: [],
  declarations: {},
  answers: {},
};

const trim = (text: string, n: number) => (text.length > n ? `${text.slice(0, n - 1)}...` : text);
const clock = (at: number) => utcTime(at);

export default function SubmitPage() {
  const params = useParams<{ slug: string }>();
  const slug = params.slug;
  const now = useNow(30_000);

  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [submission, setSubmission] = useState<Submission | null>(null);
  const [window_, setWindow] = useState<DeadlineWindow | null>(null);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [challenges, setChallenges] = useState<Challenge[]>([]);
  const [team, setTeam] = useState<Team | null>(null);
  const [teamFailed, setTeamFailed] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [gallery, setGallery] = useState<string[]>([]);
  const [imageInput, setImageInput] = useState("");
  const [uploading, setUploading] = useState<"thumbnail" | "gallery" | null>(null);
  const [tagInput, setTagInput] = useState("");
  const [inviteUrl, setInviteUrl] = useState("");
  const [copied, setCopied] = useState(false);
  const [questions, setQuestions] = useState<CustomQuestion[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState("");

  // Save state. `editVersion` counts edits so a save that finishes after
  // further typing does not mark the newer text as saved.
  const editVersion = useRef(0);
  const failedVersion = useRef(-1);
  const saving = useRef(false);
  const focusErrors = useRef(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [autoError, setAutoError] = useState("");

  async function load() {
    try {
      const [mine, trackList, questionList, entries, challengeList] = await Promise.all([
        get<MineResponse>(`/events/${slug}/submissions/mine`),
        get<Track[]>(`/events/${slug}/tracks`),
        get<CustomQuestion[]>(`/events/${slug}/questions`),
        get<HistoryEntry[]>(`/events/${slug}/submissions/mine/history`).catch(() => []),
        get<Challenge[]>(`/events/${slug}/challenges`).catch(() => [] as Challenge[]),
      ]);
      const myTeam = await get<Team | null>(`/events/${slug}/teams/mine`).catch(() => {
        setTeamFailed(true);
        return null;
      });

      setWindow(mine.window);
      setTracks(trackList);
      setChallenges(challengeList);
      setQuestions(questionList.filter((q) => (q.stage ?? "SUBMISSION") === "SUBMISSION"));
      setSubmission(mine.submission);
      setTeam(myTeam);
      setHistory(entries);

      if (mine.submission) {
        const s = mine.submission;
        setDraft({
          name: s.name ?? "",
          tagline: s.tagline ?? "",
          description: s.description ?? "",
          repoUrl: s.repoUrl ?? "",
          liveUrl: s.liveUrl ?? "",
          videoUrl: s.videoUrl ?? "",
          thumbnailUrl: s.thumbnailUrl ?? "",
          license: s.license ?? "MIT",
          trackId: s.track?.id ?? "",
          techTags: s.techTags ?? [],
          challengeIds: s.challengeIds ?? [],
          declarations: s.declarations ?? {},
          answers: Object.fromEntries(s.answers.map((a) => [a.questionId, a.value])),
        });
        setGallery((s.images ?? []).map((img) => img.url));
      }
      setLoaded(true);
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : "Could not load your submission.");
    }
  }

  useEffect(() => {
    void load();
    // load once per event
  }, [slug]);

  /** After a save only the server-owned parts are refreshed, never the text the person is typing. */
  async function refreshMeta() {
    const [mine, entries] = await Promise.all([
      get<MineResponse>(`/events/${slug}/submissions/mine`),
      get<HistoryEntry[]>(`/events/${slug}/submissions/mine/history`).catch(() => null),
    ]);
    setSubmission(mine.submission);
    setWindow(mine.window);
    if (entries) setHistory(entries);
  }

  const deadlineMs = window_?.deadline ? new Date(window_.deadline).getTime() : null;
  const pastDeadline = deadlineMs !== null && now !== null && now >= deadlineMs;
  const locked = !window_?.open || !!submission?.lockedAt || pastDeadline;
  const isSubmitted = submission?.status === "SUBMITTED";

  function markEdited() {
    editVersion.current += 1;
    setDirty(true);
    setMessage("");
  }

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    if (locked) return;
    setDraft((d) => ({ ...d, [key]: value }));
    setErrors((e) => ({ ...e, [key]: "" }));
    markEdited();
  };

  const setAnswer = (id: string, value: string) => {
    if (locked) return;
    setDraft((d) => ({ ...d, answers: { ...d.answers, [id]: value } }));
    markEdited();
  };

  const setImages = (next: string[]) => {
    setGallery(next);
    setErrors((e) => ({ ...e, images: "" }));
    markEdited();
  };

  /** Pasted links are tidied on leaving the field and checked for shape. */
  function tidyUrl(key: UrlKey) {
    if (locked) return;
    const raw = draft[key];
    const next = normalizeUrl(raw);
    if (next !== raw) set(key, next);
    if (next && !isHttpUrl(next)) {
      setErrors((e) => ({ ...e, [key]: "Enter a full link, such as https://github.com/you/project." }));
    }
  }

  /** The tags after adding whatever was typed, which may be several separated by commas. */
  function tagsWith(value: string): string[] {
    const fresh = value
      .split(",")
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean);
    const next = Array.from(new Set([...draft.techTags, ...fresh])).slice(0, MAX_TAGS);
    return next.length === draft.techTags.length ? draft.techTags : next;
  }

  function addTag() {
    const next = tagsWith(tagInput);
    if (next !== draft.techTags) set("techTags", next);
    setTagInput("");
  }

  function imagesWith(value: string): { list: string[]; invalid: boolean } {
    const url = normalizeUrl(value);
    if (!url) return { list: gallery, invalid: false };
    if (!isHttpUrl(url)) return { list: gallery, invalid: true };
    return { list: Array.from(new Set([...gallery, url])).slice(0, MAX_IMAGES), invalid: false };
  }

  async function uploadTo(target: "thumbnail" | "gallery", file: File | undefined) {
    if (!file) return;
    const key = target === "thumbnail" ? "thumbnailUrl" : "images";
    if (file.size > 20 * 1024 * 1024) {
      setErrors((e) => ({ ...e, [key]: "Images can be up to 20 MB. They are resized before upload." }));
      return;
    }
    setUploading(target);
    setErrors((e) => ({ ...e, [key]: "" }));
    try {
      const { url } = await uploadImage(file, slug);
      if (target === "thumbnail") set("thumbnailUrl", url);
      else setImages(Array.from(new Set([...gallery, url])).slice(0, MAX_IMAGES));
    } catch (err) {
      setErrors((e) => ({ ...e, [key]: err instanceof ApiError ? err.message : "That image could not be uploaded." }));
    } finally {
      setUploading(null);
    }
  }

  function addImage() {
    const { list, invalid } = imagesWith(imageInput);
    if (invalid) {
      setErrors((e) => ({ ...e, images: "That image link does not look right. Use a full https:// link." }));
      return;
    }
    if (list !== gallery) setImages(list);
    setImageInput("");
  }

  const requiredQuestions = questions.filter((q) => q.required);
  const checklist = useMemo(
    () => [
      { label: "Project name and tagline", done: !!draft.name.trim() && !!draft.tagline.trim() },
      { label: "Description, at least 40 characters", done: draft.description.trim().length >= 40 },
      { label: "At least one tech tag", done: draft.techTags.length > 0 },
      { label: "A repository or a live link", done: !!draft.repoUrl.trim() || !!draft.liveUrl.trim() },
      { label: "Licence declaration confirmed", done: !!draft.declarations.licence },
      ...requiredQuestions.map((q) => ({
        label: `Answer: ${trim(q.prompt, 48)}`,
        done: !!draft.answers[q.id]?.trim(),
      })),
    ],
    // requiredQuestions derives from questions
    [draft, questions],
  );
  const missing = checklist.filter((c) => !c.done);
  const canSubmit = missing.length === 0;
  const donePct = Math.round(((checklist.length - missing.length) / checklist.length) * 100);
  const circumference = 2 * Math.PI * 29;

  const selectedTrack = tracks.find((t) => t.id === draft.trackId) ?? null;
  const trackHue = hue(coverHue(selectedTrack?.name ?? "slate"));

  function payload(tags: string[], images: string[]) {
    return {
      name: draft.name.trim(),
      tagline: draft.tagline.trim() || null,
      description: draft.description.trim() || null,
      repoUrl: normalizeUrl(draft.repoUrl) || null,
      liveUrl: normalizeUrl(draft.liveUrl) || null,
      videoUrl: normalizeUrl(draft.videoUrl) || null,
      thumbnailUrl: normalizeUrl(draft.thumbnailUrl) || null,
      license: draft.license || null,
      trackId: draft.trackId || null,
      techTags: tags,
      challengeIds: draft.challengeIds,
      declarations: draft.declarations,
      images: images.map((url) => ({ url })),
      answers: Object.entries(draft.answers)
        .filter(([, value]) => value.trim().length > 0)
        .map(([questionId, value]) => ({ questionId, value })),
    };
  }

  function errorText(err: unknown): string {
    return err instanceof ApiError ? err.message : "Could not reach the server.";
  }

  function handleError(err: unknown) {
    focusErrors.current = true;
    if (err instanceof ApiError && err.details && typeof err.details === "object") {
      setErrors(err.details as Record<string, string>);
    }
    setMessage(errorText(err));
  }

  /**
   * Writes the form to the server. Automatic saves take the text as it is;
   * a manual save also folds in a tag or image link that was typed but not
   * yet added, so nothing is silently dropped.
   */
  async function persist(mode: "auto" | "manual"): Promise<boolean> {
    if (saving.current) return false;
    saving.current = true;
    setBusy(true);
    const version = editVersion.current;

    let tags = draft.techTags;
    let images = gallery;
    if (mode === "manual") {
      tags = tagsWith(tagInput);
      const added = imagesWith(imageInput);
      images = added.list;
      if (added.invalid) {
        setErrors((e) => ({ ...e, images: "That image link does not look right. Use a full https:// link." }));
        saving.current = false;
        setBusy(false);
        focusErrors.current = true;
        return false;
      }
      setErrors({});
      setMessage("");
    }

    try {
      const body = payload(tags, images);
      if (submission) await patch(`/events/${slug}/submissions/mine`, body);
      else await post(`/events/${slug}/submissions`, body);
      if (mode === "manual") {
        if (tags !== draft.techTags) setDraft((d) => ({ ...d, techTags: tags }));
        if (images !== gallery) setGallery(images);
        setTagInput("");
        setImageInput("");
      }
      await refreshMeta();
      if (editVersion.current === version) setDirty(false);
      setSavedAt(Date.now());
      setAutoError("");
      return true;
    } catch (err) {
      if (mode === "auto") {
        failedVersion.current = version;
        setAutoError(errorText(err));
      } else {
        handleError(err);
      }
      return false;
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }

  async function submitProject() {
    if (!(await persist("manual"))) return;
    setBusy(true);
    try {
      await post(`/events/${slug}/submissions/mine/submit`);
      await refreshMeta();
    } catch (err) {
      handleError(err);
    } finally {
      setBusy(false);
    }
  }

  // The latest persist, so the autosave timer never calls a stale closure.
  const persistRef = useRef(persist);
  persistRef.current = persist;

  // Drafts save themselves shortly after typing stops. A submitted entry is
  // public, so it only changes when the person chooses to save.
  useEffect(() => {
    if (!dirty || locked || isSubmitted || busy || !draft.name.trim()) return;
    if (failedVersion.current === editVersion.current) return;
    const timer = setTimeout(() => void persistRef.current("auto"), AUTOSAVE_MS);
    return () => clearTimeout(timer);
  }, [dirty, draft, gallery, locked, isSubmitted, busy]);

  // Warn before leaving with text that is not on the server.
  const unsaved = (dirty || !!tagInput.trim() || !!imageInput.trim()) && !locked;
  useEffect(() => {
    if (!unsaved) return;
    const beforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    const onClick = (e: MouseEvent) => {
      const link = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!link || link.target === "_blank" || link.origin !== window.location.origin) return;
      if (link.pathname === window.location.pathname && link.search === window.location.search) return;
      if (!window.confirm("You have changes that are not saved. Leave this page anyway?")) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("click", onClick, true);
    };
  }, [unsaved]);

  // After a failed save, move to the first field with a problem.
  useEffect(() => {
    if (!focusErrors.current) return;
    focusErrors.current = false;
    document.querySelector<HTMLElement>('main [aria-invalid="true"]')?.focus();
  }, [errors, message]);

  async function createInvite() {
    if (!team) return;
    try {
      const invite = await post<{ url: string }>(`/events/${slug}/teams/${team.id}/invites`, { maxUses: 1 });
      setInviteUrl(invite.url);
    } catch (err) {
      setMessage(errorText(err));
    }
  }

  if (loadError) {
    return (
      <main className="screen max-w-[1180px]">
        <EmptyState tone="danger" action={<Link href={`/events/${slug}`} className="btn">Back to the event</Link>}>
          {loadError}
        </EmptyState>
      </main>
    );
  }

  if (!loaded) {
    return (
      <main className="screen max-w-[1180px]">
        <ScreenSkeleton rows={4} />
      </main>
    );
  }

  const deadlineLine = window_?.deadline
    ? `Closes ${formatDeadline(window_.deadline)}${
        now !== null && deadlineMs !== null && deadlineMs > now ? `, in ${timeLeft(deadlineMs - now)}` : ""
      }`
    : "No deadline set";
  const deadlineUrgent = now !== null && deadlineMs !== null && deadlineMs > now && deadlineMs - now < 2 * 86_400_000;

  const summaryEntries = Object.entries(errors).filter(([, text]) => text);
  const lockedReason = submission?.lockedAt
    ? "An organizer locked this submission."
    : pastDeadline || window_?.reason === undefined
      ? "The submission deadline has passed."
      : window_.reason;

  const statusText = busy
    ? "Saving..."
    : autoError
      ? `Not saved: ${autoError} It will try again when you edit.`
      : dirty
        ? isSubmitted
          ? "Unsaved changes. The gallery entry has not changed yet."
          : draft.name.trim()
            ? "Unsaved changes. Saving shortly."
            : "Unsaved changes. Add a project name and they will save."
        : savedAt
          ? isSubmitted
            ? `Saved at ${clock(savedAt)}. The gallery entry is up to date.`
            : `Draft saved at ${clock(savedAt)}.`
          : submission
            ? isSubmitted
              ? "The gallery entry is up to date."
              : "All changes saved."
            : "Nothing saved yet.";

  return (
    <main className="screen max-w-[1180px]">
      <div className="flex flex-wrap items-center gap-[clamp(18px,3vw,28px)] border-b border-line pb-[clamp(22px,4vw,30px)]">
        <div className="min-w-0 flex-[1_1_260px]">
          <Link
            href={`/events/${slug}`}
            className="inline-flex items-center gap-[7px] font-mono text-label uppercase tracking-label text-muted transition-colors hover:text-text"
          >
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M14 6l-6 6 6 6" />
            </svg>
            Back to event
          </Link>
          <h1 className="mt-3 font-display text-console font-[560] leading-[1.08] tracking-[-0.035em]">
            {draft.name || "Untitled project"}
          </h1>
          <div className="mt-2.5 flex flex-wrap items-center gap-[9px]">
            <span
              className="inline-flex items-center rounded-full px-[9px] py-1 font-mono text-label tracking-stamp"
              style={{
                background: isSubmitted ? "var(--ok-bg)" : "var(--el)",
                color: isSubmitted ? "var(--ok-fg)" : "var(--mu)",
              }}
            >
              {isSubmitted ? "Submitted" : submission ? "Draft" : "Not started"}
            </span>
            <span
              className={`rounded-[5px] px-2 py-1 font-mono text-meta ${
                deadlineUrgent && !isSubmitted ? "bg-warning-soft text-warning-text" : "text-muted"
              }`}
            >
              {deadlineLine}
            </span>
          </div>
          {team ? (
            <p className="mt-3 max-w-[62ch] text-small leading-[1.5] text-muted">
              Entered by team <span className="font-medium text-text">{team.name}</span>. Your teammates
              work on this same entry, so if you edit together, save often and reload to see their changes.
            </p>
          ) : null}
        </div>

        <div className="flex flex-none items-center gap-3.5">
          <svg viewBox="0 0 72 72" className="block h-[68px] w-[68px]" aria-hidden="true">
            <circle cx="36" cy="36" r="29" fill="none" stroke="var(--ln)" strokeWidth="6" />
            <circle
              cx="36"
              cy="36"
              r="29"
              fill="none"
              stroke="var(--ac)"
              strokeWidth="6"
              strokeLinecap="round"
              strokeDasharray={`${(donePct / 100) * circumference} ${circumference}`}
              transform="rotate(-90 36 36)"
              style={{ transition: "stroke-dasharray 520ms cubic-bezier(0.16,1,0.3,1)" }}
            />
          </svg>
          <div>
            <div className="text-heading font-medium tracking-display tabular-nums">{donePct}%</div>
            <div className="max-w-[22ch] text-small leading-[1.4] text-muted">
              {canSubmit ? "Ready to submit." : `${missing.length} required ${missing.length === 1 ? "item" : "items"} to go.`}
            </div>
          </div>
        </div>
      </div>

      {locked ? (
        <div
          role="status"
          className="mt-[clamp(24px,4vw,32px)] flex flex-wrap items-baseline gap-3 rounded-[10px] border px-[18px] py-3.5"
          style={{ borderColor: "var(--err)", background: "var(--errbg)" }}
        >
          <span className="font-mono text-label uppercase tracking-label" style={{ color: "var(--err)" }}>
            Editing is closed
          </span>
          <span className="text-ui text-muted">
            {lockedReason} The fields below are read-only, and the server refuses edits regardless of
            what the browser sends.
          </span>
        </div>
      ) : null}

      {isSubmitted && !locked ? (
        <div
          className="card mt-[clamp(24px,4vw,32px)] flex flex-wrap items-center gap-x-6 gap-y-4 px-[clamp(20px,3vw,30px)] py-[clamp(20px,3vw,26px)]"
          style={{ animation: "pop 520ms cubic-bezier(0.16,1,0.3,1) both" }}
        >
          <div className="min-w-0 flex-[1_1_320px]">
            <h2 className="display m-0 text-page tracking-head">
              Submitted{" "}
              {submission?.submittedAt ? `at ${formatDeadline(submission.submittedAt)}` : "just now"}.
            </h2>
            <p className="mt-2.5 max-w-[56ch] text-body leading-[1.6] text-muted [text-wrap:pretty]">
              Your project is in the gallery and in the judging pool. You can keep editing until the
              deadline; after that the server stops accepting changes.
            </p>
          </div>
          <Link href={`/events/${slug}?tab=Gallery`} className="btn-primary flex-none">
            View in gallery
          </Link>
        </div>
      ) : null}

      <div className="mt-[clamp(26px,4vw,40px)] grid items-start gap-[clamp(32px,5vw,52px)] [grid-template-columns:repeat(auto-fit,minmax(min(300px,100%),1fr))]">
        <div className="min-w-0">
          <section aria-labelledby="sec-project">
            <h2 id="sec-project" className="m-0 text-title font-semibold tracking-head">
              Your project
            </h2>

            <Field
              id="f-name"
              label="Project name"
              required
              value={draft.name}
              onChange={(v) => set("name", v)}
              disabled={locked}
              error={errors.name}
              help="Shown everywhere. Changeable until the deadline."
              placeholder="Sievebox"
            />
            <Field
              id="f-tagline"
              label="Tagline"
              required
              value={draft.tagline}
              onChange={(v) => set("tagline", v)}
              disabled={locked}
              error={errors.tagline}
              help="One sentence, under 90 characters."
              placeholder="What it does, plainly"
              count={{ max: TAGLINE_MAX }}
            />
            <Field
              id="f-description"
              label="Description"
              required
              area
              value={draft.description}
              onChange={(v) => set("description", v)}
              disabled={locked}
              error={errors.description}
              help="Judges read this before the demo. At least 40 characters."
              placeholder="What you built, why, and what is genuinely finished"
            />

            <h3 className="eyebrow mt-[clamp(28px,4vw,38px)]">Track</h3>
            {tracks.length === 0 ? (
              <p className="mt-3 text-small text-muted">This event has no tracks.</p>
            ) : (
              <>
                <p className="mt-1.5 text-small text-muted">Optional. It decides which judges see your project.</p>
                <div role="group" aria-label="Track" className="mt-3 flex flex-wrap gap-1.5">
                  {tracks.map((track) => {
                    const on = draft.trackId === track.id;
                    return (
                      <button
                        key={track.id}
                        type="button"
                        aria-pressed={on}
                        disabled={locked}
                        onClick={() => set("trackId", on ? "" : track.id)}
                        className="pill max-md:min-h-[44px] disabled:cursor-not-allowed disabled:opacity-50"
                        style={{
                          background: on ? "var(--acs)" : "transparent",
                          color: on ? "var(--act)" : "var(--mu)",
                          borderColor: on ? "var(--ac)" : "var(--ln)",
                        }}
                      >
                        {track.name}
                      </button>
                    );
                  })}
                </div>
              </>
            )}

            {challenges.length > 0 ? (
              <>
                <h3 className="eyebrow mt-[clamp(28px,4vw,38px)]">Sponsor challenges</h3>
                <p className="mt-1.5 text-small text-muted">Optional. Opt in to be considered for a sponsor&apos;s prize.</p>
                <div role="group" aria-label="Sponsor challenges" className="mt-3 flex flex-wrap gap-1.5">
                  {challenges.map((c) => {
                    const on = draft.challengeIds.includes(c.id);
                    return (
                      <button
                        key={c.id}
                        type="button"
                        aria-pressed={on}
                        disabled={locked}
                        onClick={() =>
                          set("challengeIds", on ? draft.challengeIds.filter((id) => id !== c.id) : [...draft.challengeIds, c.id])
                        }
                        className="pill max-md:min-h-[44px] disabled:cursor-not-allowed disabled:opacity-50"
                        style={{
                          background: on ? "var(--acs)" : "transparent",
                          color: on ? "var(--act)" : "var(--mu)",
                          borderColor: on ? "var(--ac)" : "var(--ln)",
                        }}
                        title={`${c.sponsor}: ${c.brief}`}
                      >
                        {c.name}
                      </button>
                    );
                  })}
                </div>
              </>
            ) : null}

            <h3 className="eyebrow mt-[clamp(28px,4vw,38px)]">Tech tags</h3>
            {draft.techTags.length > 0 ? (
              <ul className="m-0 mt-3 flex list-none flex-wrap gap-1.5 p-0">
                {draft.techTags.map((tag) => (
                  <li key={tag} className="m-0">
                    <span
                      className="pill cursor-default gap-1 pr-1 max-md:min-h-[44px]"
                      style={{ background: "var(--acs)", color: "var(--act)", borderColor: "var(--ac)" }}
                    >
                      {tag}
                      <button
                        type="button"
                        disabled={locked}
                        aria-label={`Remove tag ${tag}`}
                        onClick={() => set("techTags", draft.techTags.filter((t) => t !== tag))}
                        className="grid h-6 w-6 place-items-center rounded-full hover:bg-surface/60 max-md:h-10 max-md:w-10 disabled:cursor-not-allowed"
                      >
                        <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
                          <path d="M6 6l12 12M18 6L6 18" />
                        </svg>
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
            <div className="mt-2.5 flex gap-2">
              <input
                className="field"
                aria-label="Add a tech tag"
                aria-describedby="tag-help"
                placeholder="typescript, postgres, ..."
                value={tagInput}
                disabled={locked || draft.techTags.length >= MAX_TAGS}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                onChange={(e) => {
                  const value = e.target.value;
                  if (value.endsWith(",")) {
                    const next = tagsWith(value);
                    if (next !== draft.techTags) set("techTags", next);
                    setTagInput("");
                  } else {
                    setTagInput(value);
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key !== "Enter") return;
                  e.preventDefault();
                  addTag();
                }}
                onBlur={addTag}
              />
              <button type="button" disabled={locked || !tagInput.trim()} onClick={addTag} className="btn btn-sm disabled:opacity-50">
                Add
              </button>
            </div>
            <p id="tag-help" className="mt-1.5 text-small leading-[1.5] text-muted">
              {draft.techTags.length >= MAX_TAGS
                ? `You have reached the limit of ${MAX_TAGS} tags.`
                : `Press Enter or type a comma to add one. ${draft.techTags.length} of ${MAX_TAGS} used.`}
            </p>
          </section>

          <section aria-labelledby="sec-links" className="mt-[clamp(36px,5vw,52px)]">
            <h2 id="sec-links" className="m-0 text-title font-semibold tracking-head">
              Links and media
            </h2>

            <Field
              id="f-repoUrl"
              label="Repository"
              type="url"
              value={draft.repoUrl}
              onChange={(v) => set("repoUrl", v)}
              onBlur={() => tidyUrl("repoUrl")}
              disabled={locked}
              error={errors.repoUrl}
              help="Public, or invite the judge accounts to a private repository."
              placeholder="https://github.com/..."
            />
            <Field
              id="f-liveUrl"
              label="Live deployment"
              type="url"
              value={draft.liveUrl}
              onChange={(v) => set("liveUrl", v)}
              onBlur={() => tidyUrl("liveUrl")}
              disabled={locked}
              error={errors.liveUrl}
              help="A URL a judge can open without installing anything."
              placeholder="https://sievebox.dev"
            />
            <Field
              id="f-videoUrl"
              label="Demo recording"
              type="url"
              value={draft.videoUrl}
              onChange={(v) => set("videoUrl", v)}
              onBlur={() => tidyUrl("videoUrl")}
              disabled={locked}
              error={errors.videoUrl}
              help="A link to a hosted recording, such as YouTube, Loom or a direct file. Five minutes maximum."
              placeholder="https://..."
            />
            <Field
              id="f-thumbnailUrl"
              label="Thumbnail image"
              type="url"
              value={draft.thumbnailUrl}
              onChange={(v) => set("thumbnailUrl", v)}
              onBlur={() => tidyUrl("thumbnailUrl")}
              disabled={locked}
              error={errors.thumbnailUrl}
              help="A link to an image, or upload one below (PNG, JPEG, GIF or WebP; large images are resized before upload)."
              placeholder="https://.../cover.png"
            />
            <label className={`btn btn-sm mt-2 inline-flex w-fit ${locked || uploading ? "pointer-events-none opacity-40" : "cursor-pointer"}`}>
              {uploading === "thumbnail" ? "Uploading..." : "Upload thumbnail"}
              <input
                type="file"
                accept="image/png,image/jpeg,image/gif,image/webp"
                className="sr-only"
                disabled={locked || uploading !== null}
                onChange={(e) => {
                  void uploadTo("thumbnail", e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
            </label>

            <h3 className="eyebrow mt-[clamp(28px,4vw,38px)]">Licence</h3>
            <div role="group" aria-label="Licence" className="mt-3 flex flex-wrap gap-1.5">
              {LICENCES.map((licence) => {
                const on = draft.license === licence;
                return (
                  <button
                    key={licence}
                    type="button"
                    aria-pressed={on}
                    disabled={locked}
                    onClick={() => set("license", licence)}
                    className="pill max-md:min-h-[44px] disabled:cursor-not-allowed disabled:opacity-50"
                    style={{
                      background: on ? "var(--tx)" : "transparent",
                      color: on ? "var(--bg)" : "var(--mu)",
                      borderColor: on ? "var(--tx)" : "var(--ln)",
                    }}
                  >
                    {licence}
                  </button>
                );
              })}
            </div>

            <h3 className="eyebrow mt-[clamp(28px,4vw,38px)]">Gallery images</h3>
            <p className="mt-2 text-small text-muted">
              Upload images or paste links. Uploads are kept in the event&apos;s own database, so a self-hosted
              deployment needs no object storage. The thumbnail above is the first image; add up to{" "}
              {MAX_IMAGES} more here.
            </p>
            {draft.thumbnailUrl.trim() || gallery.length > 0 ? (
              <ul className="m-0 mt-3 grid list-none gap-3 p-0 [grid-template-columns:repeat(auto-fill,minmax(140px,1fr))]">
                {draft.thumbnailUrl.trim() ? (
                  <li className="m-0 overflow-hidden rounded-lg border border-line bg-elevated">
                    <PreviewImage url={normalizeUrl(draft.thumbnailUrl)} alt="Thumbnail" className="aspect-[4/3] w-full" />
                    <div className="px-2 py-1.5 font-mono text-label text-muted">Thumbnail</div>
                  </li>
                ) : null}
                {gallery.map((url, i) => (
                  <li key={`${url}-${i}`} className="m-0 overflow-hidden rounded-lg border border-line bg-elevated">
                    <PreviewImage url={url} alt={`Gallery image ${i + 1}`} className="aspect-[4/3] w-full" />
                    <div className="flex items-center justify-between gap-2 px-2 py-1">
                      <span className="font-mono text-label text-muted">Image {i + 1}</span>
                      {!locked ? (
                        <button
                          type="button"
                          onClick={() => setImages(gallery.filter((u) => u !== url))}
                          aria-label={`Remove gallery image ${i + 1}`}
                          className="rounded px-2 py-1.5 text-small text-muted hover:text-danger max-md:min-h-[44px]"
                        >
                          Remove
                        </button>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            ) : null}
            <div className="mt-3 flex flex-wrap gap-2">
              <input
                className="field min-w-0 flex-1 font-mono text-small"
                aria-label="Add a gallery image link"
                aria-invalid={errors.images ? true : undefined}
                aria-describedby={errors.images ? "images-error" : undefined}
                type="url"
                inputMode="url"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                placeholder="https://... image link"
                value={imageInput}
                disabled={locked || gallery.length >= MAX_IMAGES}
                onChange={(e) => {
                  setImageInput(e.target.value);
                  setErrors((er) => ({ ...er, images: "" }));
                }}
                onKeyDown={(e) => {
                  if (e.key !== "Enter") return;
                  e.preventDefault();
                  addImage();
                }}
              />
              <button
                type="button"
                disabled={locked || !imageInput.trim() || gallery.length >= MAX_IMAGES}
                onClick={addImage}
                className="btn disabled:opacity-40"
              >
                Add image
              </button>
              <label
                className={`btn inline-flex ${locked || uploading || gallery.length >= MAX_IMAGES ? "pointer-events-none opacity-40" : "cursor-pointer"}`}
              >
                {uploading === "gallery" ? "Uploading..." : "Upload"}
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/gif,image/webp"
                  className="sr-only"
                  disabled={locked || uploading !== null || gallery.length >= MAX_IMAGES}
                  onChange={(e) => {
                    void uploadTo("gallery", e.target.files?.[0]);
                    e.target.value = "";
                  }}
                />
              </label>
            </div>
            {errors.images ? (
              <p id="images-error" className="mt-1.5 text-small text-danger">
                {errors.images}
              </p>
            ) : gallery.length >= MAX_IMAGES ? (
              <p className="mt-1.5 text-small text-muted">You have reached the limit of {MAX_IMAGES} gallery images.</p>
            ) : null}
          </section>

          <section aria-labelledby="sec-team" className="mt-[clamp(36px,5vw,52px)]">
            <h2 id="sec-team" className="m-0 text-title font-semibold tracking-head">
              Answers and team
            </h2>

            {questions.length > 0 ? (
              <>
                <h3 className="eyebrow mt-4">Organizer questions</h3>
                {questions.map((question) => (
                  <Field
                    key={question.id}
                    id={`q-${question.id}`}
                    label={question.prompt}
                    required={question.required}
                    area
                    value={draft.answers[question.id] ?? ""}
                    onChange={(v) => setAnswer(question.id, v)}
                    disabled={locked}
                    help={
                      question.helpText ??
                      (question.publicAnswer
                        ? "Answered publicly in the gallery."
                        : "Visible to organizers and judges only.")
                    }
                    placeholder="Your answer"
                  />
                ))}
              </>
            ) : null}

            <h3 className="eyebrow mt-[clamp(24px,4vw,34px)]">Eligibility declarations</h3>
            <div className="mt-3 grid gap-3">
              {DECLARATIONS.map((declaration) => (
                <label key={declaration.id} className="flex cursor-pointer items-start gap-3 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60">
                  <input
                    type="checkbox"
                    checked={!!draft.declarations[declaration.id]}
                    disabled={locked}
                    onChange={(e) => set("declarations", { ...draft.declarations, [declaration.id]: e.target.checked })}
                    className="mt-[3px] h-[18px] w-[18px] flex-none accent-action"
                  />
                  <span className="min-w-0">
                    <span className="block text-ui font-medium">{declaration.label}</span>
                    <span className="mt-0.5 block text-small leading-[1.5] text-muted">{declaration.hint}</span>
                  </span>
                </label>
              ))}
            </div>

            <h3 className="eyebrow mt-[clamp(24px,4vw,34px)]">Team</h3>
            {team ? (
              <>
                {team.members.map((member) => {
                  const h = hue(member.user.avatarHue);
                  return (
                    <div key={member.id} className="flex items-center gap-3 border-b border-line py-3">
                      <span
                        className="grid h-7 w-7 flex-none place-items-center rounded-[10px] font-mono text-label"
                        style={{ background: h.bg, color: h.fg }}
                        aria-hidden="true"
                      >
                        {initials(member.user.name)}
                      </span>
                      <span className="min-w-0 truncate text-ui">{member.user.name}</span>
                      <span className="font-mono text-meta text-muted">{member.role === "OWNER" ? "owner" : "member"}</span>
                      <span className="ml-auto font-mono text-label text-muted">{member.user.org ?? ""}</span>
                    </div>
                  );
                })}
                <div className="mt-3.5 flex flex-wrap items-center gap-2">
                  {inviteUrl ? (
                    <>
                      <code className="select-all break-all rounded-md border border-line bg-elevated px-[11px] py-2 font-mono text-meta text-muted">
                        {inviteUrl}
                      </code>
                      <button
                        type="button"
                        onClick={() => {
                          void navigator.clipboard?.writeText(inviteUrl).then(() => {
                            setCopied(true);
                            window.setTimeout(() => setCopied(false), 1600);
                          }).catch(() => undefined);
                        }}
                        className="btn btn-sm"
                      >
                        {copied ? "Copied" : "Copy link"}
                      </button>
                    </>
                  ) : (
                    <button type="button" onClick={() => void createInvite()} className="btn btn-sm">
                      Create invite link
                    </button>
                  )}
                </div>
                <p className="mt-2 text-small leading-[1.5] text-muted" role={inviteUrl ? "status" : undefined}>
                  {inviteUrl
                    ? "Copy it now: the link is shown only once, and podium sends no email."
                    : "Invite links work once each, and podium sends no email, so you share the link yourself."}
                </p>
              </>
            ) : teamFailed ? (
              <p className="mt-3 text-ui text-danger">Your team could not be loaded. Reload the page to try again.</p>
            ) : (
              <p className="mt-3 text-ui text-muted">
                You are not on a team in this event yet.{" "}
                <Link href={`/events/${slug}/teams`} className="underline">
                  Start or join one
                </Link>
                .
              </p>
            )}
          </section>

          {summaryEntries.length > 0 || message ? (
            <div role="alert" className="mt-8 rounded-[10px] bg-danger-soft px-4 py-3 text-small text-danger">
              {message ? <p className="m-0 font-medium">{message}</p> : null}
              {summaryEntries.length > 0 ? (
                <ul className="m-0 mt-1.5 grid list-none gap-1 p-0">
                  {summaryEntries.map(([key, text]) => (
                    <li key={key}>
                      <a href={`#f-${key}`} className="underline underline-offset-2">
                        {FIELD_LABEL[key] ?? key}
                      </a>
                      : {text}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}

          <div
            className="sticky bottom-[calc(64px+env(safe-area-inset-bottom))] z-30 mt-8 rounded-[14px] border border-line bg-surface p-3 shadow-[0_-6px_18px_-12px_rgba(24,24,27,0.25)] md:bottom-4"
          >
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2.5">
              <p role="status" className="m-0 min-w-0 flex-[1_1_220px] text-small leading-[1.45] text-muted">
                {statusText}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                {!isSubmitted ? (
                  <button
                    type="button"
                    onClick={() => void persist("manual").then(() => undefined)}
                    disabled={busy || locked}
                    className="btn max-md:min-h-[44px] disabled:opacity-60"
                  >
                    Save draft
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => (isSubmitted ? void submitProject() : dialogRef.current?.showModal())}
                  disabled={busy || locked || !canSubmit}
                  aria-describedby={!canSubmit ? "submit-help" : undefined}
                  className="btn-primary max-md:min-h-[44px] disabled:opacity-50"
                >
                  {busy ? "Working..." : isSubmitted ? "Save changes" : "Submit project"}
                </button>
              </div>
            </div>
            {!canSubmit && !locked ? (
              <p id="submit-help" className="m-0 mt-2 text-small leading-[1.45] text-muted">
                Still to do: {missing.map((m) => m.label.charAt(0).toLowerCase() + m.label.slice(1)).join("; ")}.
              </p>
            ) : null}
          </div>
        </div>

        <aside className="min-w-0">
          <div className="card p-5 pb-[22px]">
            <h2 className="eyebrow m-0">Before you submit</h2>
            <ul className="m-0 list-none p-0">
              {checklist.map((item) => (
                <li key={item.label} className="flex items-baseline gap-[11px] border-b border-line py-2.5">
                  <span className="flex w-3 flex-none justify-center" style={{ color: item.done ? "var(--ac)" : "var(--mu)" }} aria-hidden="true">
                    {item.done ? (
                      <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M5 12.5l4.5 4.5L19 7.5" />
                      </svg>
                    ) : (
                      "·"
                    )}
                  </span>
                  <span className="text-ui leading-[1.5]">
                    <span className="sr-only">{item.done ? "Done: " : "To do: "}</span>
                    {item.label}
                  </span>
                </li>
              ))}
            </ul>
            <div className="mt-3.5 h-1 overflow-hidden rounded-full bg-line" aria-hidden="true">
              <div
                className="h-full [transition:width_420ms_cubic-bezier(0.33,1,0.68,1)_60ms]"
                style={{ width: `${donePct}%`, background: "var(--ac)" }}
              />
            </div>
            <div className="mt-2 font-mono text-label text-muted">{donePct}% of required items done</div>
          </div>

          <div className="card mt-[clamp(22px,4vw,30px)] overflow-hidden">
            <h2 className="eyebrow m-0 border-b border-line bg-elevated px-[18px] py-[13px] tracking-label">
              How judges will see it
            </h2>
            {draft.thumbnailUrl.trim() ? (
              <PreviewImage url={normalizeUrl(draft.thumbnailUrl)} alt="Thumbnail preview" className="aspect-video w-full" />
            ) : (
              <div className="grid aspect-video w-full place-items-center bg-elevated text-small text-muted">No thumbnail yet</div>
            )}
            <div className="px-[18px] pb-5 pt-4">
              <div className="flex flex-wrap items-baseline gap-[9px]">
                <span className="text-body font-semibold tracking-head">{draft.name || "Untitled draft"}</span>
                {selectedTrack ? (
                  <span
                    className="rounded-full px-[7px] py-[3px] font-mono text-label uppercase tracking-stamp"
                    style={{ background: trackHue.bg, color: trackHue.fg }}
                  >
                    {selectedTrack.name}
                  </span>
                ) : null}
              </div>
              <p className="mt-2 text-ui leading-[1.55] text-muted">{draft.tagline || "No tagline yet."}</p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {draft.techTags.map((tag) => (
                  <span key={tag} className="rounded border border-line px-1.5 py-0.5 font-mono text-label text-muted">
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          </div>

          <h2 className="eyebrow mt-[clamp(26px,4vw,36px)]">Activity</h2>
          {history.length === 0 ? (
            <p className="mt-3 text-small text-muted">
              Nothing recorded yet. Every save, submit and rejected late edit is listed here, read from
              the event&apos;s audit log.
            </p>
          ) : (
            <ul className="m-0 mt-2 list-none p-0">
              {history.map((entry) => (
                <li
                  key={entry.id}
                  className="-mx-2 grid gap-3 border-b border-line px-2 py-[11px] [grid-template-columns:78px_minmax(0,1fr)]"
                >
                  <span className="font-mono text-meta leading-[1.4] text-muted">
                    {utcDateTime(entry.createdAt, { month: "short", day: "numeric" })}
                  </span>
                  <div className="min-w-0">
                    <div className="text-small leading-[1.5]">{entry.summary}</div>
                    <div className="mt-0.5 font-mono text-label text-muted">
                      {entry.action.toLowerCase().replace(/_/g, " ")}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>

      <dialog
        ref={dialogRef}
        aria-labelledby="confirm-title"
        className="w-[calc(100%-32px)] max-w-[460px] rounded-[14px] border border-line bg-surface p-6 text-text backdrop:bg-black/40"
      >
        <h2 id="confirm-title" className="m-0 text-title font-semibold tracking-head">
          Submit {draft.name.trim() || "this project"}?
        </h2>
        <p className="mt-3 text-body leading-[1.6] text-muted">
          Your project appears in the public gallery and joins the judging pool. You can keep editing
          until {window_?.deadline ? formatDeadline(window_.deadline) : "the deadline"}; after that the
          server stops accepting changes.
        </p>
        <div className="mt-6 flex flex-wrap justify-end gap-2.5">
          <button type="button" className="btn max-md:min-h-[44px]" onClick={() => dialogRef.current?.close()}>
            Keep editing
          </button>
          <button
            type="button"
            className="btn-primary max-md:min-h-[44px]"
            onClick={() => {
              dialogRef.current?.close();
              void submitProject();
            }}
          >
            Submit to the gallery
          </button>
        </div>
      </dialog>
    </main>
  );
}

function Field({
  id,
  label,
  value,
  onChange,
  onBlur,
  disabled,
  error,
  help,
  placeholder,
  required,
  area,
  type,
  count,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  disabled?: boolean;
  error?: string;
  help?: string;
  placeholder?: string;
  required?: boolean;
  area?: boolean;
  type?: "url";
  /** A soft length limit shown as a running count. */
  count?: { max: number };
}) {
  const noteId = `${id}-note`;
  const note = error || help;
  const shared = {
    id,
    value,
    disabled,
    placeholder,
    onBlur,
    "aria-invalid": error ? true : undefined,
    "aria-describedby": note ? noteId : undefined,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange(e.target.value),
    style: error ? { borderColor: "var(--err)" } : undefined,
  } as const;
  const over = count ? value.length > count.max : false;

  return (
    <div className="grid gap-[7px] border-b border-line py-4">
      <div className="flex items-baseline gap-2.5">
        <label htmlFor={id} className="text-ui font-medium">
          {label}
        </label>
        <span className={`font-mono text-label uppercase tracking-stamp ${required ? "text-text" : "text-muted"}`}>
          {required ? "required" : "optional"}
        </span>
        {count ? (
          <span className={`ml-auto font-mono text-label ${over ? "text-danger" : "text-muted"}`} aria-hidden="true">
            {value.length}/{count.max}
          </span>
        ) : null}
      </div>

      {area ? (
        <textarea rows={5} className="field resize-y leading-[1.65]" {...shared} />
      ) : (
        <input
          className="field"
          {...shared}
          {...(type === "url"
            ? { type: "url", inputMode: "url" as const, autoCapitalize: "none", autoCorrect: "off", spellCheck: false }
            : {})}
        />
      )}

      {note ? (
        <span id={noteId} className={error ? "text-small text-danger" : "text-small leading-[1.5] text-muted"}>
          {note}
        </span>
      ) : null}
    </div>
  );
}
