"use client";

import { useState, type ReactNode } from "react";

/**
 * Holds a page's filter groups. From tablet width up they are always shown;
 * on a phone they sit behind one "Filters" control so results come first, and
 * the button says how many are active.
 */
export function FilterPanel({
  activeCount,
  label = "Filters",
  children,
}: {
  activeCount: number;
  label?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="grid gap-[26px] md:gap-[26px]">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="btn justify-between md:hidden"
      >
        <span>{label}</span>
        <span className="flex items-center gap-2 text-muted">
          {activeCount > 0 ? <span className="chip bg-accent-soft text-accent-text">{activeCount} active</span> : null}
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ transform: open ? "rotate(180deg)" : undefined }}>
            <path d="M6 9.5l6 6 6-6" />
          </svg>
        </span>
      </button>
      <div className={`${open ? "grid" : "hidden"} gap-[26px] md:grid`}>{children}</div>
    </div>
  );
}
