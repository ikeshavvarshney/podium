"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { AttentionPanel } from "@/components/admin/attention-panel";
import { PhaseStrip } from "@/components/admin/phase-strip";
import { ScreenSkeleton } from "@/components/layout/screen-skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { apiBase, ApiError, get, post } from "@/lib/api";
import { hue, initials, type HueName } from "@/lib/hues";
import { formatDeadline } from "@/lib/participant-step";
import type { EventStatus } from "@/lib/types";
import { utcDateTime, utcTime } from "@/lib/format";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

interface Progress {
  target: number;
  judges: Array<{
    judgeId: string;
    name: string;
    email: string;
    org: string | null;
    assigned: number;
    completed: number;
    skipped: number;
    started: boolean;
    percent: number;
  }>;
  submissions: Array<{
    submissionId: string;
    name: string;
    track: string | null;
    assigned: number;
    received: number;
    target: number;
    complete: boolean;
  }>;
  totals: {
    judges: number;
    notStarted: number;
    assignments: number;
    ballots: number;
    fullyReviewed: number;
    submissions: number;
  };
}

interface Assignment {
  id: string;
  judgeId: string;
  submissionId: string;
}

interface AuditEntry {
  id: string;
  action: string;
  summary: string;
  ipHash: string | null;
  createdAt: string;
  actor: { id: string; name: string } | null;
}

interface PreviewRow {
  submissionId: string;
  name: string;
  rawMean: number;
  rawRank: number;
  normalizedValue: number;
  normalizedRank: number;
  display: number;
  ballotCount: number;
}

interface Preview {
  method: string;
  ballotCount: number;
  standings: PreviewRow[];
}

interface EventHeader {
  name: string;
  status: EventStatus;
  resultsPublished: boolean;
  registrationClosesAt: string | null;
  submissionDeadline: string | null;
  judgingClosesAt: string | null;
  votingClosesAt: string | null;
}

const STAGE_HUES: HueName[] = ["neutral", "info", "brand", "brand"];

const EXPORTS = [
  { file: "submissions.csv", label: "Submissions" },
  { file: "teams.csv", label: "Teams and rosters" },
  { file: "judges.csv", label: "Judges and workload" },
  { file: "scores.csv", label: "Every ballot, per criterion" },
  { file: "results.csv", label: "Standings" },
  { file: "audit.csv", label: "Audit trail" },
  { file: "event.json", label: "Full event JSON" },
];

export default function ManageEventPage() {
  const params = useParams<{ slug: string }>();
  const slug = params.slug;

  const [progress, setProgress] = useState<Progress | null>(null);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [event, setEvent] = useState<EventHeader | null>(null);
  const [audit, setAudit] = useState<AuditEntry[] | null>(null);
  const [auditFailed, setAuditFailed] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewFailed, setPreviewFailed] = useState(false);
  const [votes, setVotes] = useState<number | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const [p, a, e] = await Promise.all([
        get<Progress>(`/events/${slug}/progress`),
        get<Assignment[]>(`/events/${slug}/assignments`),
        get<EventHeader>(`/events/${slug}`),
      ]);
      setProgress(p);
      setAssignments(a);
      setEvent(e);

      get<AuditEntry[]>(`/events/${slug}/audit?take=8`)
        .then((rows) => {
          setAudit(rows);
          setAuditFailed(false);
        })
        .catch(() => setAuditFailed(true));
      get<Preview>(`/events/${slug}/results/preview`)
        .then((rows) => {
          setPreview(rows);
          setPreviewFailed(false);
        })
        .catch(() => setPreviewFailed(true));
      get<{ totalWeight: number }>(`/events/${slug}/votes/results`)
        .then((r) => setVotes(r.totalWeight))
        .catch(() => setVotes(null));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load the organizer dashboard.");
    }
  }, [slug]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error && !progress) {
    return (
      <main className="screen max-w-[1400px] pt-6">
        <EmptyState
          tone="danger"
          action={
            <span className="inline-flex flex-wrap justify-center gap-2.5">
              <button type="button" className="btn" onClick={() => void load()}>
                Try again
              </button>
              <Link href={`/events/${slug}`} className="btn">
                Back to the event
              </Link>
            </span>
          }
        >
          {error}
        </EmptyState>
      </main>
    );
  }

  if (!progress || !event) {
    return (
      <main className="screen max-w-[1400px] pt-6">
        <ScreenSkeleton rows={4} />
      </main>
    );
  }

  const { totals } = progress;
  const ballotsNeeded = totals.submissions * progress.target;
  const shortfall = Math.max(0, ballotsNeeded - totals.ballots);
  const slotsToFill = Math.max(0, ballotsNeeded - totals.assignments);

  const headline =
    totals.submissions === 0
      ? "No submissions yet."
      : shortfall > 0
        ? `Judging is open and ${shortfall} evaluation${shortfall === 1 ? "" : "s"} short.`
        : event.resultsPublished
          ? "Results are published."
          : "Every submission carries its full set of evaluations.";

  // The single most useful next move, read from the state of the event. It links
  // to a page; it never changes the event on its own.
  const next: { label: string; href: string; why: string } =
    totals.judges === 0
      ? { label: "Grant the judge role", href: `/events/${slug}/roles`, why: "No judges are on the panel yet." }
      : totals.submissions === 0
        ? { label: "Check the dates and rubric", href: `/events/${slug}/settings`, why: "Nothing has been submitted yet. Tracks, the rubric and the panel can all still change." }
        : slotsToFill > 0
          ? { label: "Assign reviewers", href: `/events/${slug}/assign`, why: `${slotsToFill} review slot${slotsToFill === 1 ? " has" : "s have"} no judge yet.` }
          : shortfall > 0
            ? { label: "See who is behind", href: "#attention", why: `${shortfall} evaluation${shortfall === 1 ? " is" : "s are"} still to come.` }
            : !event.resultsPublished
              ? { label: "Review and publish results", href: `/events/${slug}/results`, why: `Every submission has its ${progress.target} evaluations.` }
              : { label: "Announce the winners", href: `/events/${slug}/winners`, why: "Results are public." };

  const behind = progress.judges
    .filter((j) => j.percent < 100)
    .sort((a, b) => a.percent - b.percent)
    .map((j) => ({ id: j.judgeId, name: j.name, started: j.started, completed: j.completed, assigned: j.assigned }));
  const short = progress.submissions
    .filter((s) => s.assigned < s.target)
    .map((s) => ({ id: s.submissionId, name: s.name, assigned: s.assigned, target: s.target }));

  const closes = event.judgingClosesAt ? ` Judging closes ${formatDeadline(event.judgingClosesAt)}.` : "";
  const reminder = (name: string) =>
    `Hi ${name.split(" ")[0]}, a reminder that your evaluations for ${event.name} are still open.${closes} Your queue is here: ${
      typeof window === "undefined" ? "" : window.location.origin
    }/events/${slug}/judge`;

  const stages = [
    { label: "Submitted", value: totals.submissions, of: totals.submissions },
    { label: "Assigned", value: totals.assignments, of: ballotsNeeded },
    { label: "Scored", value: totals.ballots, of: ballotsNeeded },
    { label: "Published", value: event.resultsPublished ? totals.submissions : 0, of: totals.submissions },
  ];

  const assignedSet = new Set(assignments.map((a) => `${a.judgeId}:${a.submissionId}`));
  const judgesByLateness = [...progress.judges].sort((a, b) => a.percent - b.percent);

  return (
    <main className="mx-auto max-w-[1400px] px-[clamp(16px,3vw,24px)] pb-24 pt-6">
      <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-5">
        <h1 className="m-0 min-w-0 max-w-[26ch] flex-[1_1_320px] font-display text-console font-[560] leading-[1.1] tracking-[-0.035em]">{headline}</h1>
        <div className="flex max-w-[360px] flex-[0_1_360px] flex-col gap-2">
          <p className="m-0 text-small leading-[1.5] text-muted">{next.why}</p>
          <Link href={next.href} className="btn-primary min-h-[44px] justify-center">
            {next.label}
          </Link>
        </div>
      </div>

      <div className="mt-5">
        <PhaseStrip
          status={event.status}
          dates={{
            registrationClosesAt: event.registrationClosesAt,
            submissionDeadline: event.submissionDeadline,
            judgingClosesAt: event.judgingClosesAt,
            votingClosesAt: event.votingClosesAt,
          }}
        />
      </div>

      <div className="mt-6 grid items-start gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <AttentionPanel slug={slug} judges={behind} short={short} reminder={reminder} />

        <section aria-labelledby="pipeline-title" className="card p-[clamp(16px,2.4vw,22px)]">
          <h2 id="pipeline-title" className="m-0 text-title font-semibold tracking-head">
            Where the event stands
          </h2>
          <ul className="m-0 mt-3 grid list-none gap-2.5 p-0">
            {stages.map((s, i) => {
              const h = hue(STAGE_HUES[i]!);
              const pct = s.of === 0 ? 0 : Math.min(100, Math.round((s.value / s.of) * 100));
              return (
                <li key={s.label} className="m-0">
                  <div className="flex items-baseline justify-between gap-3 text-small">
                    <span className="font-medium">{s.label}</span>
                    <span className="font-mono tabular-nums text-muted">
                      {s.value} of {s.of}
                    </span>
                  </div>
                  <div className="mt-1 h-[8px] overflow-hidden rounded-full bg-elevated" aria-hidden="true">
                    <div className="h-full rounded-full [transition:width_520ms_cubic-bezier(0.16,1,0.3,1)]" style={{ width: `${pct}%`, background: h.fg }} />
                  </div>
                </li>
              );
            })}
          </ul>
          <p className="m-0 mt-3 text-small leading-[1.55] text-muted">
            Nothing publishes until every submission carries its full set of evaluations.
            {votes !== null ? ` Community votes so far: ${votes}.` : ""}
          </p>
        </section>
      </div>

      <FlaggedProjects slug={slug} />

      <section aria-labelledby="progress-title" className="mt-9">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 id="progress-title" className="m-0 text-title font-semibold tracking-head">
              Judge progress
            </h2>
            <p className="mt-1.5 text-small text-muted">
              Least complete first. One square per submission ({totals.submissions}). Organizer-only view.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3.5 font-mono text-label text-muted" aria-hidden="true">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-[2px]" style={{ background: "var(--ac)" }} />
              scored
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-[2px] border border-line bg-elevated" />
              assigned, pending
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-[2px] border border-dashed border-line" />
              not assigned
            </span>
          </div>
        </div>

        {progress.judges.length === 0 ? (
          <p className="py-8 text-center text-ui text-muted">
            No judges have been granted the role in this event yet.{" "}
            <Link href={`/events/${slug}/roles`} className="underline">
              Grant the role
            </Link>
            .
          </p>
        ) : (
          <ul className="m-0 mt-3.5 grid list-none p-0">
            {judgesByLateness.map((judge) => {
              const h = hue("brand");
              let scoredLeft = judge.completed;
              const cells = progress.submissions.map((sub) => {
                const isAssigned = assignedSet.has(`${judge.judgeId}:${sub.submissionId}`);
                const scoredHere = isAssigned && scoredLeft > 0;
                if (scoredHere) scoredLeft -= 1;
                return { sub, state: scoredHere ? "scored" : isAssigned ? "pending" : "none" };
              });
              return (
                <li
                  key={judge.judgeId}
                  className="m-0 flex flex-wrap items-center gap-x-3.5 gap-y-2 border-b border-line py-3"
                  aria-label={`${judge.name}: ${judge.completed} of ${judge.assigned} scored, ${judge.percent} percent`}
                >
                  <span className="grid h-8 w-8 flex-none place-items-center rounded-full font-mono text-label" style={{ background: h.bg, color: h.fg }} aria-hidden="true">
                    {initials(judge.name)}
                  </span>
                  <div className="w-[150px] flex-none sm:w-[200px]">
                    <div className="truncate text-ui">{judge.name}</div>
                    <div className="truncate text-small text-muted">{judge.org ?? judge.email}</div>
                  </div>
                  <div className="flex min-w-[180px] flex-[1_1_180px] gap-1" aria-hidden="true">
                    {cells.map(({ sub, state }) => (
                      <span
                        key={sub.submissionId}
                        title={`${sub.name}: ${state === "scored" ? "scored" : state === "pending" ? "assigned, pending" : "not assigned"}`}
                        className={`h-[18px] min-w-[6px] flex-1 rounded-[4px] border ${state === "none" ? "border-dashed" : ""}`}
                        style={{
                          background: state === "scored" ? "var(--ac)" : state === "pending" ? "var(--el)" : "transparent",
                          borderColor: state === "scored" ? "var(--ac)" : "var(--ln)",
                        }}
                      />
                    ))}
                  </div>
                  <span
                    className="w-12 flex-none text-right font-mono text-small tabular-nums"
                    style={{ color: judge.percent === 100 ? "var(--ac)" : judge.percent === 0 ? "var(--err)" : "var(--mu)" }}
                  >
                    {judge.percent}%
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <div className="mt-10 grid items-start gap-[clamp(24px,4vw,44px)] [grid-template-columns:repeat(auto-fit,minmax(min(340px,100%),1fr))]">
        <section aria-labelledby="preview-title" className="min-w-0">
          <div className="flex items-baseline justify-between gap-3">
            <h2 id="preview-title" className="m-0 text-title font-semibold tracking-head">
              Normalization preview
            </h2>
            <span className="font-mono text-label text-muted">{event.resultsPublished ? "published" : "unpublished"}</span>
          </div>
          <div className="mt-3">
            {previewFailed ? (
              <p className="text-ui text-danger">
                The preview could not be loaded.{" "}
                <button type="button" onClick={() => void load()} className="underline">
                  Try again
                </button>
              </p>
            ) : preview && preview.standings.length > 0 ? (
              <table className="w-full border-collapse text-left">
                <caption className="sr-only">Top eight projects: raw score, normalized score, and rank movement</caption>
                <thead>
                  <tr className="font-mono text-label uppercase tracking-stamp text-muted">
                    <th scope="col" className="w-9 pb-2 font-normal">#</th>
                    <th scope="col" className="pb-2 font-normal">Project</th>
                    <th scope="col" className="w-14 pb-2 text-right font-normal">Raw</th>
                    <th scope="col" className="w-14 pb-2 text-right font-normal">Norm</th>
                    <th scope="col" className="w-12 pb-2 text-right font-normal">Move</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.standings.slice(0, 8).map((row) => {
                    const move = row.rawRank - row.normalizedRank;
                    return (
                      <tr key={row.submissionId} className="border-t border-line">
                        <td className="py-2.5 font-mono text-meta text-muted">{String(row.normalizedRank).padStart(2, "0")}</td>
                        <td className="max-w-0 truncate py-2.5 pr-2 text-ui">{row.name}</td>
                        <td className="py-2.5 text-right font-mono text-small text-muted">{row.rawMean.toFixed(1)}</td>
                        <td className="py-2.5 text-right font-mono text-small">{row.display.toFixed(1)}</td>
                        <td
                          className="py-2.5 text-right font-mono text-meta"
                          style={{ color: move > 0 ? "var(--ac)" : move < 0 ? "var(--err)" : "var(--mu)" }}
                        >
                          {move > 0 ? `up ${move}` : move < 0 ? `down ${Math.abs(move)}` : "-"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <p className="text-ui leading-[1.6] text-muted">
                Nothing to preview yet. The table fills once ballots land, and it is recomputed from the ballots on every read rather than cached.
              </p>
            )}
          </div>
          <div className="mt-4">
            <Link href={`/events/${slug}/results`} className="btn btn-sm">
              Open results
            </Link>
          </div>
        </section>

        <section aria-labelledby="audit-title" className="min-w-0">
          <div className="flex items-baseline justify-between gap-3">
            <h2 id="audit-title" className="m-0 text-title font-semibold tracking-head">
              Audit log
            </h2>
            <Link href={`/events/${slug}/audit`} className="btn btn-sm">
              Full trail
            </Link>
          </div>
          <div className="mt-3">
            {auditFailed ? (
              <p className="text-ui text-danger">
                The audit log could not be loaded.{" "}
                <button type="button" onClick={() => void load()} className="underline">
                  Try again
                </button>
              </p>
            ) : audit === null ? (
              <p className="text-ui text-muted">Loading...</p>
            ) : audit.length === 0 ? (
              <p className="text-ui text-muted">Nothing recorded yet.</p>
            ) : (
              <ul className="m-0 list-none p-0">
                {audit.map((entry) => (
                  <li key={entry.id} className="m-0 grid gap-3.5 border-b border-line py-3 [grid-template-columns:52px_minmax(0,1fr)]">
                    <span className="font-mono text-meta text-muted">
                      {utcTime(entry.createdAt)}
                    </span>
                    <div className="min-w-0">
                      <div className="text-ui leading-[1.5] [overflow-wrap:anywhere]">{entry.summary}</div>
                      <div className="mt-1 font-mono text-label text-muted">
                        {entry.actor ? `actor: ${entry.actor.name}` : "system"}
                        {entry.ipHash ? ` · ip ${entry.ipHash.slice(0, 8)}` : ""} · {entry.action.toLowerCase().replace(/_/g, " ")}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>

      <details className="mt-10">
        <summary className="min-h-[44px] cursor-pointer text-title font-semibold tracking-head">Exports ({EXPORTS.length})</summary>
        <div className="mt-3 flex flex-wrap gap-2">
          {EXPORTS.map((item) => (
            <a key={item.file} href={`${apiBase()}/api/events/${slug}/export/${item.file}`} className="btn btn-sm">
              {item.label}
            </a>
          ))}
        </div>
        <p className="mt-3 max-w-[72ch] text-small leading-[1.6] text-muted">
          Every export is organizer-only and enforced on the server. The ballot export contains one row per criterion, so the weighted maths can be rechecked by hand.
        </p>
      </details>
    </main>
  );
}

interface FlaggedRow {
  id: string;
  name: string;
  status: string;
  flagReason: string | null;
  flaggedAt: string | null;
  team: { name: string };
}

function FlaggedProjects({ slug }: { slug: string }) {
  const [rows, setRows] = useState<FlaggedRow[]>([]);
  const [restoring, setRestoring] = useState<FlaggedRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(
    () =>
      get<FlaggedRow[]>(`/events/${slug}/submissions/all`)
        .then((all) => setRows(all.filter((s) => s.status === "DISQUALIFIED")))
        .catch(() => setRows([])),
    [slug],
  );
  useEffect(() => {
    void load();
  }, [load]);

  async function restore(row: FlaggedRow) {
    setBusy(true);
    setError("");
    try {
      await post(`/events/${slug}/submissions/${row.id}/restore`, {});
      setRestoring(null);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "The project could not be restored.");
    } finally {
      setBusy(false);
    }
  }

  if (rows.length === 0) return null;

  return (
    <section aria-labelledby="flagged-title" className="mt-9">
      <h2 id="flagged-title" className="m-0 text-title font-semibold tracking-head">
        Flagged projects
      </h2>
      <p className="mt-1.5 text-small leading-[1.5] text-muted">
        Hidden from the gallery, judging, voting, results and winners. Still stored, and still in the exports.
      </p>
      <div className="mt-3 grid">
        {rows.map((r) => (
          <div key={r.id} className="flex flex-wrap items-center gap-3 border-b border-line py-3">
            <div className="min-w-0 flex-[1_1_260px]">
              <div className="text-ui">
                {r.name} <span className="text-muted">· {r.team.name}</span>
              </div>
              <div className="text-small leading-[1.5] text-muted">
                {r.flagReason}
                {r.flaggedAt ? ` · ${utcDateTime(r.flaggedAt)}` : ""}
              </div>
            </div>
            <button type="button" onClick={() => setRestoring(r)} className="btn btn-sm flex-none">
              Restore
            </button>
          </div>
        ))}
      </div>
      {error ? <p className="mt-2 text-small text-danger">{error}</p> : null}
      <ConfirmDialog
        open={restoring !== null}
        title={restoring ? `Restore ${restoring.name}?` : ""}
        confirmLabel="Restore"
        busy={busy}
        onConfirm={() => restoring && void restore(restoring)}
        onCancel={() => setRestoring(null)}
      >
        <p className="m-0">It returns to the gallery, judge queues, community voting, results and winners.</p>
      </ConfirmDialog>
    </section>
  );
}
