"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { apiBase, ApiError, del, get, post } from "@/lib/api";
import { hue, initials, type HueName } from "@/lib/hues";
import { Notice } from "@/components/ui/notice";
import { PageStatus } from "@/components/ui/page-status";
import { PageHeader } from "@/components/ui/page-header";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

const JUDGE_HUES: HueName[] = ["neutral", "brand", "info"];

interface Progress {
  target: number;
  judges: Array<{
    judgeId: string;
    name: string;
    email: string;
    org: string | null;
    trackScope: string[];
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
  status: string;
  judge: { id: string; name: string; email: string };
  submission: { id: string; name: string; track: { name: string } | null };
}

export default function AssignPage() {
  const params = useParams<{ slug: string }>();
  const slug = params.slug;

  const [progress, setProgress] = useState<Progress | null>(null);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [eventName, setEventName] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<"clear" | "balance" | null>(null);
  const [undo, setUndo] = useState<{ judgeId: string; submissionId: string; label: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const [p, a, e] = await Promise.all([
        get<Progress>(`/events/${slug}/progress`),
        get<Assignment[]>(`/events/${slug}/assignments`),
        get<{ name: string }>(`/events/${slug}`),
      ]);
      setProgress(p);
      setAssignments(a);
      setEventName(e.name);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load the assignment board.");
    }
  }, [slug]);

  useEffect(() => {
    void load();
  }, [load]);

  const bySubmission = useMemo(() => {
    const map = new Map<string, Assignment[]>();
    for (const a of assignments) {
      const list = map.get(a.submissionId) ?? [];
      list.push(a);
      map.set(a.submissionId, list);
    }
    return map;
  }, [assignments]);

  const maxLoad = useMemo(
    () => Math.max(1, ...(progress?.judges.map((j) => j.assigned) ?? [1])),
    [progress],
  );

  async function autoBalance() {
    setConfirm(null);
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const res = await post<{ applied: number; shortfalls: Array<{ submissionId: string; missing: number }> }>(
        `/events/${slug}/assignments/generate`,
        {},
      );
      setNotice(
        res.applied === 0
          ? "Every project already carries its full set of reviewers."
          : `${res.applied} assignment${res.applied === 1 ? "" : "s"} added.${
              res.shortfalls.length ? ` ${res.shortfalls.length} project(s) could not be filled.` : ""
            }`,
      );
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Auto-balance failed.");
    } finally {
      setBusy(false);
    }
  }

  async function clearAll() {
    setConfirm(null);
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const res = await del<{ removed: number; kept: number }>(`/events/${slug}/assignments`);
      setNotice(
        `${res.removed} unscored assignment${res.removed === 1 ? "" : "s"} cleared.${
          res.kept ? ` ${res.kept} already scored ${res.kept === 1 ? "was" : "were"} kept.` : ""
        }`,
      );
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Assignments could not be cleared.");
    } finally {
      setBusy(false);
    }
  }

  async function assign(submissionId: string) {
    if (!selected) return;
    setError("");
    try {
      await post(`/events/${slug}/assignments`, { judgeId: selected, submissionId });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "That assignment was refused.");
    }
  }

  async function unassign(assignment: Assignment) {
    setError("");
    setNotice("");
    try {
      await del(`/events/${slug}/assignments/${assignment.id}`);
      setUndo({
        judgeId: assignment.judgeId,
        submissionId: assignment.submissionId,
        label: `${assignment.judge.name} was removed from ${assignment.submission.name}.`,
      });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "That assignment could not be removed.");
    }
  }

  async function undoRemoval() {
    if (!undo) return;
    const { judgeId, submissionId } = undo;
    setUndo(null);
    setError("");
    try {
      await post(`/events/${slug}/assignments`, { judgeId, submissionId });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "That assignment could not be restored.");
    }
  }

  if (!progress) {
    return (
      <PageStatus eyebrow="Judge assignment" maxWidth="max-w-[1400px]" error={error} />
    );
  }

  const selectedJudge = progress.judges.find((j) => j.judgeId === selected) ?? null;
  const uncovered = progress.submissions.filter((s) => s.assigned < s.target).length;
  const slotsToFill = progress.submissions.reduce((sum, s) => sum + Math.max(0, s.target - s.assigned), 0);
  const panelSize = Math.max(1, progress.judges.length);
  const fairShare = Math.ceil((progress.totals.submissions * progress.target) / panelSize);
  const barMax = Math.max(1, fairShare, maxLoad);

  const stats: Array<{ label: string; value: string; hue: HueName }> = [
    { label: "Submissions", value: String(progress.totals.submissions), hue: "info" },
    { label: "Reviews assigned", value: String(progress.totals.assignments), hue: "brand" },
    { label: "Target per entry", value: String(progress.target), hue: "neutral" },
    { label: "Short of target", value: String(uncovered), hue: uncovered === 0 ? "success" : "warning" },
  ];
  const judgeHue = new Map(
    progress.judges.map((j, i) => [j.judgeId, JUDGE_HUES[i % JUDGE_HUES.length]!]),
  );

  return (
    <main className="screen max-w-[1400px] pt-[clamp(26px,4vw,40px)] pb-[120px]">
      <PageHeader
        back={{ href: `/events/${slug}/manage`, label: "Dashboard" }}
        eyebrow={`Assignment · Auto-balance target: ${progress.target} judges per project`}
        title="Judge assignment"
        lead={
          <>
            {eventName}:{" "}
            {uncovered === 0
              ? `every submission has its ${progress.target} reviewers.`
              : `${uncovered} submission${uncovered === 1 ? " is" : "s are"} short of ${progress.target} reviewers.`}{" "}
            A judge is never assigned their own team&apos;s project, and track scope is enforced on the server.
          </>
        }
        actions={
          <>
            <a href={`${apiBase()}/api/events/${slug}/export/judges.csv`} className="btn font-mono text-meta">
              Export panel CSV
            </a>
            <button type="button" onClick={() => setConfirm("clear")} disabled={busy || assignments.length === 0} className="btn text-muted hover:text-text disabled:opacity-40">
              Clear all
            </button>
            <button type="button" onClick={() => (slotsToFill > 0 ? setConfirm("balance") : void autoBalance())} disabled={busy} className="btn-primary disabled:opacity-40">
              {busy ? "Balancing..." : "Auto-balance"}
            </button>
          </>
        }
      />

      {error ? (
        <Notice className="mt-5">{error}</Notice>
      ) : null}
      {notice ? (
        <Notice tone="success" className="mt-5">{notice}</Notice>
      ) : null}
      {undo ? (
        <div role="status" className="mt-5 flex flex-wrap items-center gap-3 rounded-[10px] bg-elevated px-[13px] py-2 text-small">
          <span className="min-w-0 flex-1">{undo.label}</span>
          <button type="button" onClick={() => void undoRemoval()} className="btn btn-sm">
            Undo
          </button>
        </div>
      ) : null}

      <div className="mt-[clamp(22px,3vw,30px)] grid gap-2.5 [grid-template-columns:repeat(auto-fit,minmax(min(150px,100%),1fr))]">
        {stats.map((k) => (
          <div key={k.label} className="kpi" style={{ borderTopColor: hue(k.hue).fg }}>
            <div className="eyebrow">{k.label}</div>
            <div className="mt-[7px] font-mono text-heading tabular-nums" style={{ color: hue(k.hue).fg }}>
              {k.value}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-[clamp(22px,3vw,30px)] flex flex-wrap items-start gap-[clamp(18px,2.4vw,26px)]">
        <section className="flex min-w-0 max-w-[360px] flex-[1_1_290px] flex-col gap-2.5">
          <h2 className="eyebrow m-0">Judge panel</h2>
          {progress.judges.length === 0 ? (
            <p className="text-small text-muted">
              No judges yet.{" "}
              <Link href={`/events/${slug}/roles`} className="underline">
                Grant the judge role
              </Link>{" "}
              to get started.
            </p>
          ) : null}
          {progress.judges.map((j) => {
            const on = selected === j.judgeId;
            const h = hue(judgeHue.get(j.judgeId) ?? "slate");
            return (
              <button
                key={j.judgeId}
                type="button"
                aria-pressed={on}
                onClick={() => setSelected(on ? null : j.judgeId)}
                className="flex w-full items-start gap-3 rounded-[11px] border p-[13px_14px] text-left [transition:border-color_420ms_cubic-bezier(0.33,1,0.68,1)_60ms,background-color_200ms] hover:border-muted"
                style={{
                  borderColor: on ? "var(--ac)" : "var(--ln)",
                  background: on ? "var(--acs)" : "var(--sf)",
                }}
              >
                <span
                  className="grid h-[30px] w-[30px] flex-none place-items-center rounded-full font-mono text-label"
                  style={{ background: h.bg, color: h.fg }}
                >
                  {initials(j.name)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-ui font-medium tracking-head">{j.name}</span>
                  <span className="mt-[3px] block text-small text-muted">{j.org ?? j.email}</span>
                  <span className="mt-2.5 flex items-center gap-[9px]">
                    <svg viewBox="0 0 200 6" preserveAspectRatio="none" className="block h-[6px] w-full" aria-hidden="true">
                      <rect x="0" y="0" width="200" height="6" rx="3" fill="var(--el)" />
                      <rect
                        x="0"
                        y="0"
                        width={Math.min(200, Math.round((j.assigned / barMax) * 200))}
                        height="6"
                        rx="3"
                        fill="var(--ac)"
                        className="[transition:width_420ms_cubic-bezier(0.33,1,0.68,1)_60ms]"
                      />
                    </svg>
                    <span className="whitespace-nowrap font-mono text-label text-muted">
                      {j.assigned} assigned, about {fairShare} each
                    </span>
                  </span>
                </span>
              </button>
            );
          })}
          <p className="mt-1 text-small leading-[1.55] text-muted">
            {selectedJudge
              ? `Pick a project on the right to assign it to ${selectedJudge.name}. Tap a reviewer chip to remove that assignment.`
              : "Select a judge, then pick projects on the right. Auto-balance fills every project to target with the least-loaded eligible judge."}
          </p>
        </section>

        <section className="grid min-w-0 flex-[3_1_440px] gap-2.5">
          <h2 className="eyebrow m-0">Submissions</h2>
          {progress.submissions.map((s) => {
            const rows = bySubmission.get(s.submissionId) ?? [];
            const already = rows.some((a) => a.judgeId === selected);
            const short = s.assigned < s.target;
            return (
              <div
                key={s.submissionId}
                className="flex flex-wrap items-center gap-y-3 gap-x-[18px] rounded-[11px] border border-line bg-surface px-[clamp(14px,2vw,18px)] py-3.5"
              >
                <div className="min-w-0 flex-[1_1_200px]">
                  <div className="flex flex-wrap items-baseline gap-[9px]">
                    <span className="text-body font-medium tracking-head">{s.name}</span>
                    <span className="font-mono text-label uppercase tracking-stamp text-muted">
                      {s.track ?? "No track"}
                    </span>
                  </div>
                  <div className="mt-1 truncate text-small text-muted">
                    {s.received} of {s.target} ballots received
                  </div>
                </div>

                <div className="flex flex-[1_1_130px] flex-wrap items-center justify-end gap-[7px]">
                  {rows.map((a) => {
                    const h = hue(judgeHue.get(a.judgeId) ?? "slate");
                    return (
                      <button
                        key={a.id}
                        type="button"
                        title={`${a.judge.name} · remove assignment`}
                        aria-label={`Remove ${a.judge.name} from ${s.name}`}
                        onClick={() => void unassign(a)}
                        className="relative grid h-7 w-7 flex-none place-items-center rounded-full border border-transparent font-mono text-label before:absolute before:-inset-2 before:content-[''] hover:border-current"
                        style={{ background: h.bg, color: h.fg }}
                      >
                        {initials(a.judge.name)}
                      </button>
                    );
                  })}
                  {rows.length === 0 ? (
                    <span className="font-mono text-label text-muted">No reviewers yet</span>
                  ) : null}
                </div>

                <span
                  className="flex-none rounded-md px-[9px] py-1 font-mono text-meta tabular-nums tracking-stamp"
                  style={{
                    background: short ? "var(--errbg)" : "var(--ok-bg)",
                    color: short ? "var(--err)" : "var(--ok-fg)",
                  }}
                >
                  {s.assigned}/{s.target}
                </span>

                {already ? (
                  <span className="flex-none whitespace-nowrap rounded-lg bg-elevated px-[13px] py-2 text-small text-muted">
                    {selectedJudge?.name.split(" ")[0]} is assigned
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => void assign(s.submissionId)}
                    disabled={!selectedJudge}
                    title={selectedJudge ? `Assign ${selectedJudge.name}` : "Select a judge on the left first"}
                    className="btn btn-sm flex-none whitespace-nowrap hover:border-accent disabled:border-dashed disabled:text-muted"
                  >
                    {selectedJudge ? `Add ${selectedJudge.name.split(" ")[0]}` : "Add judge"}
                  </button>
                )}
              </div>
            );
          })}
        </section>
      </div>

      <ConfirmDialog
        open={confirm === "balance"}
        title="Auto-balance the panel?"
        confirmLabel="Fill empty slots"
        onConfirm={() => void autoBalance()}
        onCancel={() => setConfirm(null)}
      >
        <p className="m-0">
          {slotsToFill} review slot{slotsToFill === 1 ? " is" : "s are"} empty across {uncovered} project{uncovered === 1 ? "" : "s"}. Each is filled with
          the least-loaded eligible judge. A judge is never given their own team&apos;s project, and track scope is respected.
        </p>
        <p className="m-0 mt-2">Nothing is removed, and you can still change any single assignment afterwards.</p>
      </ConfirmDialog>

      <ConfirmDialog
        open={confirm === "clear"}
        title="Clear every assignment?"
        confirmLabel="Clear assignments"
        tone="danger"
        onConfirm={() => void clearAll()}
        onCancel={() => setConfirm(null)}
      >
        <p className="m-0">
          This removes the {assignments.length} assignment{assignments.length === 1 ? "" : "s"} on the board that have not been scored yet, so judges lose those
          projects from their queues.
        </p>
        <p className="m-0 mt-2">Assignments a judge has already scored are kept. You would need to assign the rest again or run Auto-balance.</p>
      </ConfirmDialog>
    </main>
  );
}
