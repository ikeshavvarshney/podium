"use client";

import { useEffect, useRef } from "react";
import { STATE_LABEL, type ItemState, type QueueItem } from "./types";

/** One mark per state, so the queue reads at a glance and never by colour alone. */
export function StateMark({ state, size = 18 }: { state: ItemState; size?: number }) {
  const common = { width: size, height: size, viewBox: "0 0 20 20", fill: "none", "aria-hidden": true } as const;
  if (state === "submitted") {
    return (
      <svg {...common}>
        <circle cx="10" cy="10" r="9" fill="var(--ac)" />
        <path d="M5.8 10.4l3 3 5.6-6.2" stroke="var(--action-fg)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (state === "edited") {
    return (
      <svg {...common}>
        <circle cx="10" cy="10" r="8.2" fill="var(--acs)" stroke="var(--ac)" strokeWidth="1.6" />
        <path d="M6.2 13.8l.6-2.6 5.6-5.6 2 2-5.6 5.6z" fill="var(--act)" />
      </svg>
    );
  }
  if (state === "draft") {
    return (
      <svg {...common}>
        <circle cx="10" cy="10" r="8.2" stroke="var(--ac)" strokeWidth="1.6" strokeDasharray="3 2.4" />
        <circle cx="10" cy="10" r="2.6" fill="var(--ac)" />
      </svg>
    );
  }
  if (state === "skipped") {
    return (
      <svg {...common}>
        <circle cx="10" cy="10" r="8.2" stroke="var(--mu)" strokeWidth="1.6" />
        <path d="M6.4 10h7.2" stroke="var(--mu)" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <circle cx="10" cy="10" r="8.2" stroke="var(--ln-strong)" strokeWidth="1.6" />
    </svg>
  );
}

/**
 * The judge's own queue. A column beside the work on wide screens, a
 * swipeable strip of numbered chips above it on narrow ones. The current
 * project scrolls into view when it changes.
 */
export function QueueRail({
  items,
  states,
  index,
  onSelect,
}: {
  items: QueueItem[];
  states: ItemState[];
  index: number;
  onSelect: (i: number) => void;
}) {
  const currentRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    currentRef.current?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [index]);

  return (
    <nav aria-label="Your queue" className="min-w-0">
      <ol className="m-0 flex list-none gap-1.5 overflow-x-auto p-0 pb-1 lg:flex-col lg:gap-1 lg:overflow-visible lg:pb-0">
        {items.map((item, i) => {
          const state = states[i]!;
          const current = i === index;
          return (
            <li key={item.assignmentId} className="m-0 flex-none lg:flex-auto">
              <button
                ref={current ? currentRef : undefined}
                type="button"
                onClick={() => onSelect(i)}
                aria-current={current ? "true" : undefined}
                aria-label={`${i + 1}. ${item.submission.name}: ${STATE_LABEL[state]}`}
                title={`${item.submission.name} (${STATE_LABEL[state]})`}
                className={`flex min-h-[44px] w-full cursor-pointer items-center gap-2.5 rounded-[10px] border px-3 text-left transition-colors max-lg:min-w-[44px] max-lg:justify-center max-lg:px-2.5 ${
                  current
                    ? "border-accent-line bg-accent-soft text-accent-text"
                    : "border-transparent text-text hover:bg-elevated"
                }`}
              >
                <StateMark state={state} />
                <span className="font-mono text-meta tabular-nums text-muted lg:w-5 lg:text-right">{i + 1}</span>
                <span className="min-w-0 flex-1 truncate text-ui max-lg:hidden">{item.submission.name}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
