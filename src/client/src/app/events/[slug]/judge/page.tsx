"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Ballot, type Primary } from "@/components/judge/ballot";
import { Comparative } from "@/components/judge/comparative";
import { ProjectPane } from "@/components/judge/project-pane";
import { QueueRail } from "@/components/judge/queue-rail";
import {
  sameAsServer,
  scoresOf,
  stateOf,
  type BordaStandings,
  type Criterion,
  type Draft,
  type GroupsResponse,
  type Queue,
  type SignedRecord,
} from "@/components/judge/types";
import { EmptyState } from "@/components/ui/empty-state";
import { ApiError, get, post, put } from "@/lib/api";
import { readDrafts, writeDrafts } from "@/lib/judge-draft";
import { formatDeadline, timeLeft } from "@/lib/participant-step";
import { useNow } from "@/lib/use-now";

const DAY = 86_400_000;

function SignedRecordCard({ record, slug }: { record: SignedRecord; slug: string }) {
  return (
    <section aria-labelledby="record-title" className="card mt-5 px-[18px] py-4">
      <h2 id="record-title" className="eyebrow m-0">
        Signed participation record
      </h2>
      <p className="mt-2 text-small leading-[1.6] text-muted">
        Judging for {record.payload.event.name} is finished. Here is a dated, cryptographically signed attestation of
        the projects you scored: publicly verifiable, not just a certificate image. It names what you reviewed, never the scores
        you gave.
      </p>
      <code className="mt-3 block select-all break-all rounded-[10px] bg-elevated px-3 py-2.5 font-mono text-meta">{record.hash}</code>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => {
            const blob = new Blob([JSON.stringify(record, null, 2)], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `podium-judge-record-${slug}.json`;
            a.click();
            URL.revokeObjectURL(url);
          }}
          className="btn-primary btn-sm"
        >
          Download record
        </button>
        <Link href={`/verify?slug=${slug}`} className="btn btn-sm">
          Verify signature
        </Link>
        <span className="font-mono text-label text-muted">
          {record.key.algorithm} · {record.payload.counts.scored} of {record.payload.counts.assigned} scored
        </span>
      </div>
    </section>
  );
}

export default function JudgeConsolePage() {
  const params = useParams<{ slug: string }>();
  const slug = params.slug;
  const now = useNow(30_000);

  const [queue, setQueue] = useState<Queue | null>(null);
  const [criteria, setCriteria] = useState<Criterion[]>([]);
  const [index, setIndex] = useState(0);
  const [active, setActive] = useState(0);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [draftsReady, setDraftsReady] = useState(false);
  const [error, setError] = useState("");
  const [errorReload, setErrorReload] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState<{ message: string; denied: boolean } | null>(null);
  const [mode, setMode] = useState<"RUBRIC" | "COMPARATIVE">("RUBRIC");
  const [record, setRecord] = useState<SignedRecord | null>(null);
  const [closesAt, setClosesAt] = useState<string | null>(null);
  const [announce, setAnnounce] = useState("");
  const [groups, setGroups] = useState<GroupsResponse | null>(null);
  const [borda, setBorda] = useState<BordaStandings | null>(null);
  const [groupIndex, setGroupIndex] = useState(0);
  const [order, setOrder] = useState<string[]>([]);

  const headingRef = useRef<HTMLHeadingElement>(null);
  const submitRef = useRef<HTMLButtonElement>(null);
  const barRef = useRef<HTMLButtonElement>(null);
  const moved = useRef(false);

  const load = useCallback(async (): Promise<Queue | null> => {
    try {
      const [q, rubric] = await Promise.all([
        get<Queue>(`/events/${slug}/judge/queue`),
        get<{ criteria: Criterion[]; mode: "RUBRIC" | "COMPARATIVE" } | null>(`/events/${slug}/rubric`),
      ]);
      setQueue(q);
      setCriteria(rubric?.criteria ?? []);
      setMode(rubric?.mode ?? "RUBRIC");
      setLoadError(null);

      // The event's own judging deadline, for the clock. Optional context.
      get<{ judgingClosesAt: string | null; resultsPublished?: boolean }>(`/events/${slug}`)
        .then((e) => {
          setClosesAt(e.judgingClosesAt);
          // A record only exists once judging has closed, so do not ask before then.
          const closed = e.resultsPublished || (e.judgingClosesAt && new Date(e.judgingClosesAt).getTime() < Date.now());
          if (!closed) return;
          return get<SignedRecord>(`/events/${slug}/judge/record`).then(setRecord);
        })
        .catch(() => setRecord(null));

      if (rubric?.mode === "COMPARATIVE") {
        const [g, standings] = await Promise.all([
          get<GroupsResponse>(`/events/${slug}/judge/groups`),
          get<BordaStandings>(`/events/${slug}/rankings/standings`).catch(() => null),
        ]);
        setGroups(g);
        setBorda(standings);
        const firstOpen = g.groups.findIndex((row) => row.ranking === null && !row.skipped);
        const at = firstOpen === -1 ? 0 : firstOpen;
        setGroupIndex(at);
        setOrder(g.groups[at]?.submissions.map((sub) => sub.id) ?? []);
      }
      return q;
    } catch (err) {
      setLoadError({
        message: err instanceof ApiError ? err.message : "Could not load your queue.",
        denied: err instanceof ApiError && (err.status === 401 || err.status === 403),
      });
      return null;
    }
  }, [slug]);

  useEffect(() => {
    void load();
  }, [load]);

  // Drafts live in this browser. They are read once, then written back on every change.
  useEffect(() => {
    setDrafts(readDrafts(slug));
    setDraftsReady(true);
  }, [slug]);
  useEffect(() => {
    if (draftsReady) writeDrafts(slug, drafts);
  }, [slug, drafts, draftsReady]);

  // Forget drafts that match what the server has, or belong to projects no longer in the queue.
  useEffect(() => {
    if (!queue || !draftsReady) return;
    setDrafts((prev) => {
      const byId = new Map(queue.items.map((it) => [it.submission.id, it]));
      let changed = false;
      const next: Record<string, Draft> = {};
      for (const [id, draft] of Object.entries(prev)) {
        const item = byId.get(id);
        if (!item || (item.myScore && sameAsServer(draft, item.myScore))) {
          changed = true;
          continue;
        }
        next[id] = draft;
      }
      return changed ? next : prev;
    });
  }, [queue, draftsReady]);

  const items = queue?.items ?? [];
  const current = items[Math.min(index, Math.max(items.length - 1, 0))];
  const draft = current ? drafts[current.submission.id] : undefined;
  const scores = draft?.scores ?? scoresOf(current?.myScore ?? null);
  const comment = draft ? draft.comment : (current?.myScore?.comment ?? "");

  // Start on the first criterion still to score, so typing a digit never overwrites finished work.
  const currentId = current?.submission.id;
  useEffect(() => {
    if (!current) return;
    const first = criteria.findIndex((c) => scores[c.id] === undefined);
    setActive(first === -1 ? 0 : first);
    // only when the project or rubric changes
  }, [currentId, criteria.length]);

  const states = useMemo(() => items.map((it) => stateOf(it, drafts[it.submission.id])), [items, drafts]);
  const state = current ? states[Math.min(index, items.length - 1)]! : "pending";

  const weightSum = criteria.reduce((sum, c) => sum + c.weight, 0) || 1;
  const weightedTotal = useMemo(() => {
    let acc = 0;
    for (const criterion of criteria) {
      const value = scores[criterion.id];
      if (value === undefined) continue;
      const span = criterion.maxScore - criterion.minScore;
      acc += (span > 0 ? (value - criterion.minScore) / span : 0) * criterion.weight;
    }
    return Math.round((acc / weightSum) * 1000) / 10;
  }, [criteria, scores, weightSum]);
  const allScored = criteria.length > 0 && criteria.every((c) => scores[c.id] !== undefined);

  const closesMs = closesAt ? new Date(closesAt).getTime() : null;
  const pastClose = closesMs !== null && now !== null && now >= closesMs;
  const locked = !queue?.window.open || pastClose;

  const saveDraft = (next: Draft) => {
    if (!current || locked) return;
    const id = current.submission.id;
    const empty = Object.keys(next.scores).length === 0 && !next.comment.trim();
    const matches = current.myScore ? sameAsServer(next, current.myScore) : empty;
    setDrafts((prev) => {
      const copy = { ...prev };
      if (matches) delete copy[id];
      else copy[id] = next;
      return copy;
    });
    setError("");
  };
  const setScore = (criterionId: string, value: number) => saveDraft({ scores: { ...scores, [criterionId]: value }, comment });

  const select = useCallback(
    (i: number) => {
      if (!queue) return;
      moved.current = true;
      setIndex(Math.min(Math.max(i, 0), queue.items.length - 1));
      setActive(0);
      setError("");
    },
    [queue],
  );
  const move = useCallback((delta: number) => select(index + delta), [select, index]);

  // After moving to another project, put focus on its name so assistive tech announces it.
  useEffect(() => {
    if (!moved.current) return;
    moved.current = false;
    headingRef.current?.focus();
  }, [index]);

  function failure(err: unknown, fallback: string) {
    if (err instanceof ApiError) {
      if (err.status === 401 || err.status === 403) {
        setError("Your access to judging for this event has changed. Reload the page to check what you can still do.");
        setErrorReload(false);
      } else if (err.status === 404 || err.status === 409 || err.status === 410) {
        setError("This project can no longer be scored. It may have been reassigned, or judging has closed.");
        setErrorReload(true);
      } else {
        const detail = err.details ? Object.values(err.details)[0] : undefined;
        setError(detail ?? err.message);
        setErrorReload(false);
      }
    } else {
      setError(`${fallback} Your scores are still saved on this device.`);
      setErrorReload(false);
    }
  }

  async function submitBallot() {
    if (!current || locked || busy) return;
    if (!allScored) {
      setError("Score every criterion before submitting this evaluation.");
      setErrorReload(false);
      return;
    }
    setBusy(true);
    setError("");
    const submittedId = current.submission.id;
    const submittedName = current.submission.name;
    try {
      await put(`/events/${slug}/judge/scores/${submittedId}`, {
        criteria: criteria.map((c) => ({ criterionId: c.id, value: scores[c.id]! })),
        comment: comment.trim() || null,
      });
      setDrafts((prev) => {
        const copy = { ...prev };
        delete copy[submittedId];
        return copy;
      });
      const fresh = await load();
      const list = fresh?.items ?? items;
      const next = list.findIndex((item, i) => i > index && !item.myScore);
      const wrap = list.findIndex((item) => !item.myScore);
      const target = next >= 0 ? next : wrap >= 0 ? wrap : index;
      setAnnounce(
        wrap === -1
          ? `Saved ${submittedName}. All evaluations are submitted.`
          : `Saved ${submittedName}. Showing project ${target + 1} of ${list.length}: ${list[target]?.submission.name ?? ""}.`,
      );
      select(target);
    } catch (err) {
      failure(err, "Could not submit this evaluation.");
    } finally {
      setBusy(false);
    }
  }

  async function skip() {
    if (!current || locked) return;
    const name = current.submission.name;
    try {
      await post(`/events/${slug}/judge/skip/${current.submission.id}`, { reason: null });
      await load();
      setAnnounce(`Skipped ${name}. It stays in your queue.`);
      move(1);
    } catch (err) {
      failure(err, "Could not skip this project.");
    }
  }

  const focusCriterion = (i: number) => {
    document.querySelector<HTMLElement>(`[data-criterion="${i}"] [role="radio"][tabindex="0"]`)?.focus();
  };
  const focusSubmit = () => {
    // Wait a tick: the button only becomes enabled once the last score has rendered.
    window.setTimeout(() => {
      [submitRef.current, barRef.current].find((b) => b && b.offsetParent !== null && !b.disabled)?.focus();
    }, 60);
  };

  const stateNow = state;
  const hasNext = index < items.length - 1;
  const primary: Primary = locked
    ? { label: "Judging is closed", onClick: () => undefined, disabled: true }
    : stateNow === "submitted"
      ? hasNext
        ? { label: "Next project", onClick: () => move(1), disabled: false }
        : { label: "All caught up", onClick: () => undefined, disabled: true }
      : {
          label: busy ? "Saving..." : stateNow === "edited" ? "Resubmit changes" : "Submit and next",
          onClick: () => void submitBallot(),
          disabled: busy || !allScored,
        };

  // Keyboard: digits score the active criterion and move on, arrows move between criteria,
  // J and K move between projects, Ctrl or Cmd plus Enter submits. Nothing fires from a text field.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      if (target?.closest?.("textarea, input, select, [contenteditable='true']")) return;
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        if (!primary.disabled) primary.onClick();
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey || !current || mode !== "RUBRIC") return;

      if (/^[0-9]$/.test(e.key) && !locked) {
        const criterion = criteria[active];
        if (!criterion) return;
        const value = e.key === "0" ? 10 : Number(e.key);
        if (value < criterion.minScore || value > criterion.maxScore) return;
        e.preventDefault();
        const nextScores = { ...scores, [criterion.id]: value };
        saveDraft({ scores: nextScores, comment });
        if (criteria.every((c) => nextScores[c.id] !== undefined)) {
          focusSubmit();
        } else {
          const nextUnscored = criteria.findIndex((c, i) => i > active && nextScores[c.id] === undefined);
          const to = nextUnscored >= 0 ? nextUnscored : Math.min(active + 1, criteria.length - 1);
          setActive(to);
          focusCriterion(to);
        }
        return;
      }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const to = Math.min(Math.max(active + (e.key === "ArrowDown" ? 1 : -1), 0), criteria.length - 1);
        setActive(to);
        focusCriterion(to);
        return;
      }
      if (e.key.toLowerCase() === "j") move(1);
      if (e.key.toLowerCase() === "k") move(-1);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // Unsent scores live only on this device, so say so before the tab is closed.
  const unsent = Object.keys(drafts).length > 0;
  useEffect(() => {
    if (!unsent) return;
    const guard = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [unsent]);

  if (loadError) {
    return (
      <main className="screen max-w-[1400px] pt-5">
        <EmptyState
          tone="danger"
          action={
            <span className="inline-flex flex-wrap justify-center gap-2.5">
              {loadError.denied ? null : (
                <button type="button" className="btn" onClick={() => void load()}>
                  Try again
                </button>
              )}
              <Link href={`/events/${slug}`} className="btn">
                Back to the event
              </Link>
            </span>
          }
        >
          {loadError.denied ? "You do not have judge access to this event, or it was removed." : loadError.message}
        </EmptyState>
      </main>
    );
  }

  if (!queue) {
    return (
      <main role="status" aria-label="Loading your queue" className="mx-auto max-w-[1400px] px-[clamp(16px,3vw,24px)] pt-5">
        <div className="skeleton h-[14px] w-[220px] rounded" />
        <div className="mt-5 grid gap-6 md:grid-cols-[minmax(0,1fr)_380px] lg:grid-cols-[210px_minmax(0,1fr)_400px]" aria-hidden="true">
          <div className="skeleton hidden h-[260px] rounded-[14px] lg:block" />
          <div className="skeleton h-[380px] rounded-[14px]" />
          <div className="skeleton h-[420px] rounded-[14px]" />
        </div>
      </main>
    );
  }

  if (mode === "COMPARATIVE" && groups) {
    const confirmRanking = async (skipped: boolean) => {
      const group = groups.groups[groupIndex];
      if (!group) return;
      setBusy(true);
      setError("");
      try {
        await post(`/events/${slug}/judge/rankings`, { order, skipped });
        const [g, standings] = await Promise.all([
          get<GroupsResponse>(`/events/${slug}/judge/groups`),
          get<BordaStandings>(`/events/${slug}/rankings/standings`).catch(() => null),
        ]);
        setGroups(g);
        setBorda(standings);
        const nextOpen = g.groups.findIndex((row) => row.ranking === null && !row.skipped);
        const at = nextOpen === -1 ? Math.min(groupIndex + 1, g.groups.length - 1) : nextOpen;
        setGroupIndex(at);
        setOrder(g.groups[at]?.submissions.map((sub) => sub.id) ?? []);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "That ranking was refused.");
      } finally {
        setBusy(false);
      }
    };
    return (
      <Comparative
        groups={groups}
        borda={borda}
        groupIndex={groupIndex}
        order={order}
        onOrder={setOrder}
        busy={busy}
        error={error}
        locked={locked}
        onConfirm={(skipped) => void confirmRanking(skipped)}
        onRedo={() => {
          setGroupIndex(0);
          setOrder(groups.groups[0]?.submissions.map((sub) => sub.id) ?? []);
        }}
      />
    );
  }

  const total = queue.total;
  const pct = total === 0 ? 0 : Math.round((queue.completed / total) * 100);
  const left = total - queue.completed;
  const queueDone = total > 0 && left === 0;
  const remainingMs = closesMs !== null && now !== null ? closesMs - now : null;
  const urgent = remainingMs !== null && remainingMs > 0 && remainingMs < 2 * DAY && left > 0;
  const range = criteria.length
    ? `${Math.min(...criteria.map((c) => c.minScore))}-${Math.min(9, Math.max(...criteria.map((c) => c.maxScore)))}`
    : "1-5";
  const legend = [
    { key: range, label: "score" },
    { key: "↑ ↓", label: "criterion" },
    { key: "J K", label: "project" },
    { key: "Ctrl Enter", label: "submit" },
  ];

  return (
    <main className="mx-auto max-w-[1400px] px-[clamp(16px,3vw,24px)] pb-28 pt-4">
      <p role="status" className="sr-only">
        {announce}
      </p>

      <header className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-line pb-3">
        <span className="font-mono text-meta uppercase tracking-label text-muted">
          {total === 0 ? "No projects" : `Project ${Math.min(index + 1, total)} of ${total}`}
        </span>
        <div
          className="h-1 min-w-[120px] flex-[1_1_180px] overflow-hidden rounded-full bg-line"
          role="progressbar"
          aria-label="Evaluations submitted"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={queue.completed}
        >
          <div className="h-full bg-accent [transition:width_420ms_cubic-bezier(0.33,1,0.68,1)]" style={{ width: `${pct}%` }} />
        </div>
        <span className="font-mono text-small text-muted">
          {queue.completed} of {total} submitted
        </span>
        {!queue.window.open && !pastClose ? (
          <span className="rounded-[5px] px-2 py-1 font-mono text-meta leading-[1.5] text-muted">Judging closed</span>
        ) : closesAt ? (
          <span
            className={`rounded-[5px] px-2 py-1 font-mono text-meta leading-[1.5] ${urgent ? "bg-warning-soft text-warning-text" : "text-muted"}`}
          >
            Judging closes {formatDeadline(closesAt)}
            {remainingMs !== null && remainingMs > 0 ? `, in ${timeLeft(remainingMs)}` : ""}
            {left > 0 ? ` · ${left} left` : ""}
          </span>
        ) : null}
      </header>

      {locked ? (
        <div role="status" className="mt-4 rounded-[10px] border border-line bg-elevated px-4 py-3 text-small leading-[1.55]">
          <span className="font-medium">Judging is closed.</span>{" "}
          <span className="text-muted">
            {queue.window.reason ? `${queue.window.reason} ` : ""}Your evaluations are kept and stay readable, but they can no longer be changed.
          </span>
        </div>
      ) : null}

      {record ? <SignedRecordCard record={record} slug={slug} /> : null}

      {queueDone ? (
        <div className="mt-4 rounded-[10px] border border-line bg-success-soft px-4 py-3.5">
          <h2 className="m-0 text-ui font-semibold">All {queue.completed} evaluations submitted.</h2>
          <p className="m-0 mt-1 text-small leading-[1.55] text-muted">
            Your scores are sealed: you cannot see other judges&apos; evaluations, and they cannot see yours. Organizers are notified automatically. You can still review or change any of them below
            {locked ? " until judging closes" : ""}.
          </p>
        </div>
      ) : null}

      {total === 0 ? (
        <div className="card mt-8 p-[clamp(24px,5vw,48px)] text-center">
          <h2 className="m-0 text-heading font-semibold tracking-head">Nothing assigned yet.</h2>
          <p className="mx-auto mt-2.5 max-w-[50ch] text-ui leading-[1.6] text-muted">
            The organizer has not allocated your queue for this event. It will appear here as soon as assignment runs.
          </p>
          <div className="mt-5 flex justify-center gap-2.5">
            <button type="button" className="btn" onClick={() => void load()}>
              Check again
            </button>
            <Link href={`/events/${slug}`} className="btn">
              Back to the event
            </Link>
          </div>
        </div>
      ) : current ? (
        <>
          <div className="mt-4 grid items-start gap-x-6 gap-y-5 md:grid-cols-[minmax(0,1fr)_380px] lg:grid-cols-[210px_minmax(0,1fr)_400px]">
            <div className="md:col-span-2 lg:sticky lg:top-[112px] lg:col-span-1 lg:max-h-[calc(100dvh-128px)] lg:self-start lg:overflow-y-auto">
              <QueueRail items={items} states={states} index={index} onSelect={select} />
              <p className="m-0 mt-2 font-mono text-label text-muted max-lg:hidden">
                {queue.completed} submitted, {left} left
              </p>
              <div className="mt-4 grid gap-1.5 max-lg:hidden" aria-label="Keyboard shortcuts" role="group">
                {legend.map((shortcut) => (
                  <span key={shortcut.label} className="inline-flex items-center gap-2 text-meta text-muted">
                    <kbd className="min-w-[52px] rounded-[4px] border border-line bg-elevated px-1.5 py-0.5 text-center font-mono text-label text-text">{shortcut.key}</kbd>
                    {shortcut.label}
                  </span>
                ))}
              </div>
            </div>

            <ProjectPane item={current} headingRef={headingRef} />

            <div className="lg:sticky lg:top-[112px] lg:max-h-[calc(100dvh-128px)] lg:self-start lg:overflow-y-auto">
              <Ballot
                projectId={current.submission.id}
                criteria={criteria}
                scores={scores}
                comment={comment}
                active={active}
                onActive={setActive}
                onScore={setScore}
                onComment={(value) => saveDraft({ scores, comment: value })}
                locked={locked}
                allScored={allScored}
                weightedTotal={weightedTotal}
                state={state}
                busy={busy}
                error={error}
                onReload={errorReload ? () => { setError(""); setErrorReload(false); void load(); } : undefined}
                primary={primary}
                submitRef={submitRef}
                onSkip={() => void skip()}
                onPrev={() => move(-1)}
                onNext={() => move(1)}
                hasPrev={index > 0}
                hasNext={hasNext}
              />
            </div>
          </div>

          <div className="sticky bottom-[calc(64px+env(safe-area-inset-bottom))] z-30 mt-5 rounded-[14px] border border-line bg-surface p-2.5 shadow-[0_-6px_18px_-12px_rgba(24,24,27,0.25)] md:bottom-4 lg:hidden">
            <div className="flex items-center gap-3">
              <p className="m-0 min-w-0 flex-1 text-small leading-[1.4] text-muted">
                {busy ? "Saving..." : allScored ? `Total ${weightedTotal.toFixed(1)}` : `${criteria.filter((c) => scores[c.id] !== undefined).length} of ${criteria.length} scored`}
              </p>
              <button
                ref={barRef}
                type="button"
                onClick={primary.onClick}
                disabled={primary.disabled}
                className="btn-primary min-h-[44px] flex-none px-5 disabled:opacity-50"
              >
                {primary.label}
              </button>
            </div>
          </div>
        </>
      ) : null}
    </main>
  );
}
