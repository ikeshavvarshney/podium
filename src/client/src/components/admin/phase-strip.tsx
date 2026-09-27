"use client";

import { formatDeadline, timeLeft } from "@/lib/participant-step";
import type { EventStatus } from "@/lib/types";
import { useNow } from "@/lib/use-now";

const PHASES: Array<{ id: string; label: string; statuses: EventStatus[] }> = [
  { id: "setup", label: "Setup", statuses: ["DRAFT", "PUBLISHED"] },
  { id: "registration", label: "Registration", statuses: ["REGISTRATION_OPEN"] },
  { id: "submissions", label: "Submissions", statuses: ["SUBMISSIONS_OPEN"] },
  { id: "judging", label: "Judging", statuses: ["JUDGING"] },
  { id: "voting", label: "Voting", statuses: ["VOTING"] },
  { id: "results", label: "Results", statuses: ["RESULTS_PUBLISHED", "ARCHIVED"] },
];

export interface PhaseDates {
  registrationClosesAt: string | null;
  submissionDeadline: string | null;
  judgingClosesAt: string | null;
  votingClosesAt: string | null;
}

const CLOSING: Record<string, { key: keyof PhaseDates; label: string }> = {
  registration: { key: "registrationClosesAt", label: "Registration closes" },
  submissions: { key: "submissionDeadline", label: "Submissions close" },
  judging: { key: "judgingClosesAt", label: "Judging closes" },
  voting: { key: "votingClosesAt", label: "Voting closes" },
};

/**
 * Where the event is in its run, and what the current phase is counting down
 * to. It reports the event's status; it does not change it.
 */
export function PhaseStrip({ status, dates }: { status: EventStatus; dates: PhaseDates }) {
  const now = useNow(30_000);
  const at = Math.max(0, PHASES.findIndex((p) => p.statuses.includes(status)));
  const phase = PHASES[at]!;
  const closing = CLOSING[phase.id];
  const iso = closing ? dates[closing.key] : null;
  const ms = iso ? new Date(iso).getTime() : null;
  const left = ms !== null && now !== null ? ms - now : null;
  const urgent = left !== null && left > 0 && left < 2 * 86_400_000;

  return (
    <section aria-label="Event phase" className="min-w-0">
      <ol className="relative m-0 flex list-none gap-1.5 overflow-x-auto p-0 pb-1">
        {PHASES.map((p, i) => {
          const past = i < at;
          const current = i === at;
          return (
            <li key={p.id} className="m-0 flex-none">
              <span
                aria-current={current ? "step" : undefined}
                className={`inline-flex min-h-[36px] items-center gap-2 rounded-full border px-3.5 text-small ${
                  current
                    ? "border-accent-line bg-accent-soft font-medium text-accent-text"
                    : past
                      ? "border-line text-muted"
                      : "border-dashed border-line text-muted"
                }`}
              >
                {past ? (
                  <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M5 12.5l4.5 4.5L19 7.5" />
                  </svg>
                ) : null}
                {p.label}
                <span className="sr-only">{current ? " (current phase)" : past ? " (done)" : " (later)"}</span>
              </span>
            </li>
          );
        })}
      </ol>
      {closing && iso ? (
        <p
          className={`mt-2.5 inline-block rounded-[5px] px-2 py-1 font-mono text-meta leading-[1.5] ${
            urgent ? "bg-warning-soft text-warning-text" : "text-muted"
          }`}
        >
          {closing.label} {formatDeadline(iso)}
          {left !== null && left > 0 ? `, in ${timeLeft(left)}` : left !== null ? ", now closed" : ""}
        </p>
      ) : null}
    </section>
  );
}
