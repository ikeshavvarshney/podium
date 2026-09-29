"use client";

import Link from "next/link";
import { useMemo } from "react";
import { stepFor } from "@/lib/participant-step";
import type { EventSummary } from "@/lib/types";
import { useEventStatus } from "@/lib/use-event-status";
import { useNow } from "@/lib/use-now";

const SUBMISSION_LABEL: Record<string, string> = {
  DRAFT: "Draft, not submitted",
  SUBMITTED: "Submitted",
  WITHDRAWN: "Withdrawn",
  DISQUALIFIED: "Disqualified",
};

/**
 * A registered participant's place on the event overview: their team, their
 * submission, the deadline, and the one next step. Replaces a register button
 * they have already used.
 */
export function ParticipantPanel({ event }: { event: EventSummary }) {
  const now = useNow();
  const rows = useMemo(() => [{ event, roles: ["PARTICIPANT"] }], [event]);
  const data = useEventStatus(rows)(event);
  const step = stepFor(event, ["PARTICIPANT"], data, now);

  const max = event.maxTeamSize;
  const min = event.minTeamSize;
  const team = !data.loaded
    ? "Checking..."
    : data.team
      ? `${data.team.members} member${data.team.members === 1 ? "" : "s"}${min && max ? ` (teams of ${min} to ${max})` : ""}`
      : "Not on a team yet";
  const submission = !data.loaded
    ? "Checking..."
    : data.submission
      ? (SUBMISSION_LABEL[data.submission.status] ?? data.submission.status)
      : "None yet";

  return (
    <section aria-label="Your status" className="rounded-[10px] border border-line bg-surface p-4">
      <h2 className="m-0 text-ui font-semibold">Your status</h2>
      <dl className="m-0 mt-3 grid gap-2.5 text-small">
        <div>
          <dt className="text-muted">Team</dt>
          <dd className="m-0 font-medium">{team}</dd>
        </div>
        <div>
          <dt className="text-muted">Submission</dt>
          <dd className="m-0 font-medium">{submission}</dd>
        </div>
      </dl>
      {step.deadline ? (
        <p
          className={`mt-3 rounded-[5px] px-2 py-1 font-mono text-meta leading-[1.5] ${
            step.urgent ? "bg-warning-soft text-warning-text" : "bg-elevated text-muted"
          }`}
        >
          {step.deadline}
        </p>
      ) : null}
      <p className="mt-3 text-small leading-[1.5] text-muted">{step.sentence}</p>
      <Link href={step.action.href} className="btn-primary mt-3 w-full px-[18px] py-[11px] text-ui">
        {step.action.label}
      </Link>
    </section>
  );
}
