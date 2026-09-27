"use client";

import Link from "next/link";
import { useState } from "react";

export interface BehindJudge {
  id: string;
  name: string;
  started: boolean;
  completed: number;
  assigned: number;
}

export interface ShortProject {
  id: string;
  name: string;
  assigned: number;
  target: number;
}

/**
 * What the organizer owes the event right now: judges who are behind, by name
 * and least complete first, and projects without enough reviewers. Each row
 * has the one action that fixes it. podium sends no email, so the reminder is
 * text to copy and send however the organizer already talks to their panel.
 */
export function AttentionPanel({
  slug,
  judges,
  short,
  reminder,
}: {
  slug: string;
  judges: BehindJudge[];
  short: ShortProject[];
  reminder: (judgeName: string) => string;
}) {
  const [copied, setCopied] = useState<string | null>(null);
  const nothing = judges.length === 0 && short.length === 0;

  const copy = (judge: BehindJudge) => {
    void navigator.clipboard
      ?.writeText(reminder(judge.name))
      .then(() => {
        setCopied(judge.id);
        window.setTimeout(() => setCopied((c) => (c === judge.id ? null : c)), 1800);
      })
      .catch(() => undefined);
  };

  return (
    <section id="attention" aria-labelledby="attention-title" className="card p-[clamp(16px,2.4vw,22px)]">
      <h2 id="attention-title" className="m-0 text-title font-semibold tracking-head">
        Needs you now
      </h2>
      {nothing ? (
        <p className="mt-2 text-ui text-muted">Nothing needs you right now. Every judge is on track and every project has its reviewers.</p>
      ) : (
        <div className="mt-3 grid gap-5 [grid-template-columns:repeat(auto-fit,minmax(min(300px,100%),1fr))]">
          {judges.length > 0 ? (
            <div className="min-w-0">
              <h3 className="eyebrow m-0">Judges behind</h3>
              <ul className="m-0 mt-1.5 list-none p-0">
                {judges.slice(0, 5).map((j) => (
                  <li key={j.id} className="m-0 flex items-center gap-3 border-b border-line py-2.5">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-ui font-medium">{j.name}</div>
                      <div className="text-small text-muted">
                        {j.started ? `${j.completed} of ${j.assigned} scored` : j.assigned === 0 ? "Nothing assigned yet" : "Has not opened the queue"}
                      </div>
                    </div>
                    <button type="button" onClick={() => copy(j)} className="btn btn-sm flex-none" aria-label={`Copy a reminder for ${j.name}`}>
                      {copied === j.id ? "Copied" : "Copy reminder"}
                    </button>
                  </li>
                ))}
              </ul>
              {judges.length > 5 ? <p className="m-0 mt-2 text-small text-muted">And {judges.length - 5} more in the progress table below.</p> : null}
            </div>
          ) : null}

          {short.length > 0 ? (
            <div className="min-w-0">
              <h3 className="eyebrow m-0">Projects short of reviewers</h3>
              <ul className="m-0 mt-1.5 list-none p-0">
                {short.slice(0, 5).map((p) => (
                  <li key={p.id} className="m-0 flex items-center gap-3 border-b border-line py-2.5">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-ui font-medium">{p.name}</div>
                      <div className="text-small text-muted">
                        {p.assigned} of {p.target} reviewers
                      </div>
                    </div>
                    <Link href={`/events/${slug}/assign`} className="btn btn-sm flex-none" aria-label={`Assign reviewers to ${p.name}`}>
                      Assign
                    </Link>
                  </li>
                ))}
              </ul>
              {short.length > 5 ? <p className="m-0 mt-2 text-small text-muted">And {short.length - 5} more on the assignment board.</p> : null}
            </div>
          ) : null}
        </div>
      )}
      <p role="status" className="sr-only">
        {copied ? "Reminder copied to the clipboard." : ""}
      </p>
    </section>
  );
}
