"use client";

import { useEffect, useState, type RefObject } from "react";
import { StateMark } from "./queue-rail";
import { STATE_LABEL, type Criterion, type ItemState } from "./types";

const STATE_NOTE: Record<ItemState, string> = {
  submitted: "Sent. You can change it until judging closes.",
  edited: "Saved on this device. The organizers still have your earlier scores.",
  draft: "Saved on this device. Not sent to the organizers yet.",
  skipped: "You skipped this one. It stays in your queue.",
  pending: "Score every criterion, then submit.",
};

const CHIP: Record<ItemState, string> = {
  submitted: "bg-success-soft text-success-text",
  edited: "bg-warning-soft text-warning-text",
  draft: "bg-accent-soft text-accent-text",
  skipped: "bg-elevated text-muted",
  pending: "bg-elevated text-muted",
};

export interface Primary {
  label: string;
  onClick: () => void;
  disabled: boolean;
}

/**
 * The scoring ballot: one radio group per criterion, the active one marked,
 * a note field, and the actions. It is the visually dominant part of the
 * judging screen, so nothing decorative sits between a judge and the scores.
 */
export function Ballot({
  projectId,
  criteria,
  scores,
  comment,
  active,
  onActive,
  onScore,
  onComment,
  locked,
  allScored,
  weightedTotal,
  state,
  busy,
  error,
  onReload,
  primary,
  submitRef,
  onSkip,
  onPrev,
  onNext,
  hasPrev,
  hasNext,
}: {
  /** Changes when the judge moves to another project, so the notes field re-collapses. */
  projectId: string;
  criteria: Criterion[];
  scores: Record<string, number>;
  comment: string;
  active: number;
  onActive: (i: number) => void;
  onScore: (criterionId: string, value: number) => void;
  onComment: (value: string) => void;
  locked: boolean;
  allScored: boolean;
  weightedTotal: number;
  state: ItemState;
  busy: boolean;
  error: string;
  onReload?: () => void;
  primary: Primary;
  submitRef: RefObject<HTMLButtonElement | null>;
  onSkip: () => void;
  onPrev: () => void;
  onNext: () => void;
  hasPrev: boolean;
  hasNext: boolean;
}) {
  const weightSum = criteria.reduce((sum, c) => sum + c.weight, 0) || 1;
  const scored = criteria.filter((c) => scores[c.id] !== undefined).length;
  const [notesOpen, setNotesOpen] = useState(false);
  useEffect(() => setNotesOpen(comment.trim().length > 0), [projectId]); // reset per project only

  return (
    <section aria-labelledby="ballot-title" className="card min-w-0">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-line px-4 py-3">
        <h2 id="ballot-title" className="m-0 text-title font-semibold tracking-head">
          Your evaluation
        </h2>
        <span className={`chip gap-1.5 ${CHIP[state]}`}>
          <StateMark state={state} size={14} />
          {busy ? "Saving..." : STATE_LABEL[state]}
        </span>
      </div>
      <p className="m-0 px-4 pt-2.5 text-small leading-[1.5] text-muted">{STATE_NOTE[state]}</p>

      <div className="px-2 pb-1 pt-1.5">
        {criteria.map((criterion, ci) => {
          const options = Array.from({ length: criterion.maxScore - criterion.minScore + 1 }, (_, i) => criterion.minScore + i);
          const chosen = scores[criterion.id];
          const isActive = ci === active;
          const share = Math.round((criterion.weight / weightSum) * 100);
          const labelId = `crit-${criterion.id}`;
          const hintId = `${labelId}-hint`;
          const stops = chosen ?? options[0];
          return (
            <div
              key={criterion.id}
              data-criterion={ci}
              onFocusCapture={() => onActive(ci)}
              onPointerDown={() => onActive(ci)}
              className={`rounded-[10px] px-2 py-2 transition-colors ${isActive ? "bg-elevated" : ""}`}
            >
              <div className="flex items-baseline gap-2.5">
                <span id={labelId} className="text-ui font-medium">
                  {criterion.label}
                </span>
                <span className="font-mono text-label text-muted">{share}% of total</span>
                <span className="ml-auto font-mono text-ui tabular-nums" aria-hidden="true" style={{ color: chosen ? "var(--tx)" : "var(--mu)" }}>
                  {chosen ? `${chosen} / ${criterion.maxScore}` : "-"}
                </span>
              </div>
              {criterion.hint ? (
                <p id={hintId} className="mt-1 text-small leading-[1.5] text-muted">
                  {criterion.hint}
                </p>
              ) : null}
              <div
                role="radiogroup"
                aria-labelledby={labelId}
                aria-describedby={criterion.hint ? hintId : undefined}
                className="mt-1.5 grid gap-1"
                style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
              >
                {options.map((value) => {
                  const on = chosen === value;
                  return (
                    <button
                      key={value}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      aria-label={`${criterion.label}, ${value} of ${criterion.maxScore}`}
                      tabIndex={value === stops ? 0 : -1}
                      disabled={locked}
                      onClick={() => onScore(criterion.id, value)}
                      onKeyDown={(e) => {
                        if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
                        e.preventDefault();
                        const next = value + (e.key === "ArrowRight" ? 1 : -1);
                        if (next < criterion.minScore || next > criterion.maxScore) return;
                        onScore(criterion.id, next);
                        const radios = e.currentTarget.parentElement?.querySelectorAll<HTMLElement>('[role="radio"]');
                        radios?.[next - criterion.minScore]?.focus();
                      }}
                      className={`min-h-[44px] cursor-pointer rounded-[10px] border font-mono text-ui tabular-nums transition-colors hover:border-muted disabled:cursor-not-allowed disabled:opacity-50 ${
                        on ? "border-[var(--btn-bd)] [background:var(--btn-fill)] text-[var(--btn-fg)]" : "border-line-strong bg-surface text-muted"
                      }`}
                    >
                      {value}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      <div className="px-4 pb-1 pt-2">
        <div className="flex items-baseline justify-between gap-3" title="The server recomputes the total from the stored rubric when you submit.">
          <span className="text-ui text-muted">{allScored ? "Weighted total" : `${scored} of ${criteria.length} scored`}</span>
          <span className="text-heading font-semibold tracking-head tabular-nums" style={{ color: allScored ? "var(--tx)" : "var(--mu)" }}>
            {allScored ? weightedTotal.toFixed(1) : "-"}
          </span>
        </div>

        <button
          type="button"
          aria-expanded={notesOpen}
          aria-controls="judge-comment"
          onClick={() => setNotesOpen((v) => !v)}
          className="mt-2 flex min-h-[44px] w-full cursor-pointer items-center justify-between gap-2 text-left text-ui font-medium lg:min-h-[36px]"
        >
          <span>
            Notes <span className="font-normal text-muted">(optional, seen by organizers, not the team)</span>
          </span>
          <span className="text-muted" aria-hidden="true">{notesOpen ? "−" : "+"}</span>
        </button>
        {notesOpen ? (
          <textarea
            id="judge-comment"
            rows={3}
            value={comment}
            disabled={locked}
            onChange={(e) => onComment(e.target.value)}
            aria-label="Notes on this project"
            className="field resize-y leading-[1.55]"
          />
        ) : null}

        {error ? (
          <div role="alert" className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[10px] bg-danger-soft px-3 py-2.5 text-small leading-[1.5] text-danger">
            <span className="min-w-0 flex-1">{error}</span>
            {onReload ? (
              <button type="button" onClick={onReload} className="btn btn-sm bg-surface text-text">
                Reload queue
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="px-4 pb-4 pt-3 max-lg:pb-3">
        <button
          ref={submitRef}
          type="button"
          onClick={primary.onClick}
          disabled={primary.disabled}
          className="btn-primary min-h-[44px] w-full py-3 text-ui disabled:opacity-50 max-lg:hidden"
        >
          {primary.label}
        </button>
        <div className="mt-2 grid grid-cols-3 gap-2 max-lg:mt-0">
          <button type="button" onClick={onPrev} disabled={!hasPrev} className="btn btn-sm min-h-[44px] disabled:opacity-40">
            Previous
          </button>
          <button type="button" onClick={onSkip} disabled={locked || busy} className="btn btn-sm min-h-[44px] disabled:opacity-40">
            Skip
          </button>
          <button type="button" onClick={onNext} disabled={!hasNext} className="btn btn-sm min-h-[44px] disabled:opacity-40">
            Next
          </button>
        </div>
      </div>
    </section>
  );
}
