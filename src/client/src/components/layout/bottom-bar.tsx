"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { NavIcon } from "@/components/layout/nav-icon";

export interface BarItem {
  key: string;
  href: string;
  label: string;
  active: boolean;
}

export interface SheetGroup {
  title: string;
  items: BarItem[];
}

/**
 * The phone's navigation: a fixed bar of a few destinations plus More, which
 * opens a sheet with everything else. Built for the thumb, and separate from
 * the desktop tab row rather than a squeezed copy of it.
 */
export function BottomBar({
  label,
  items,
  sheetTitle,
  sheetSubtitle,
  groups,
}: {
  label: string;
  items: BarItem[];
  sheetTitle: string;
  sheetSubtitle?: ReactNode;
  groups: SheetGroup[];
}) {
  const [open, setOpen] = useState(false);
  const moreRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const moreActive = groups.some((g) => g.items.some((i) => i.active)) && !items.some((i) => i.active);

  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    panel?.focus();
    const trigger = moreRef.current;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        return;
      }
      if (e.key !== "Tab" || !panel) return;
      const focusable = panel.querySelectorAll<HTMLElement>("a[href], button:not([disabled])");
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (e.shiftKey && (document.activeElement === first || document.activeElement === panel)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      trigger?.focus();
    };
  }, [open]);

  const cell =
    "relative flex min-w-0 flex-col items-center justify-center gap-[3px] px-1 pb-1.5 pt-2 text-small transition-colors duration-200";
  const mark = <span className="absolute inset-x-3 top-0 h-[2px] rounded-b bg-accent" aria-hidden="true" />;

  return (
    <>
      <nav
        aria-label={label}
        className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] md:hidden print:hidden"
      >
        <ul
          className="m-0 grid list-none p-0"
          style={{ gridTemplateColumns: `repeat(${items.length + 1}, minmax(0, 1fr))` }}
        >
          {items.map((item) => (
            <li key={item.key} className="min-w-0">
              <Link
                href={item.href}
                aria-current={item.active ? "page" : undefined}
                className={`${cell} ${item.active ? "font-medium text-accent" : "text-muted"}`}
              >
                {item.active ? mark : null}
                <NavIcon name={item.key} />
                <span className="max-w-full truncate">{item.label}</span>
              </Link>
            </li>
          ))}
          <li className="min-w-0">
            <button
              ref={moreRef}
              type="button"
              aria-haspopup="dialog"
              aria-expanded={open}
              onClick={() => setOpen(true)}
              className={`${cell} w-full cursor-pointer border-0 bg-transparent ${
                moreActive ? "font-medium text-accent" : "text-muted"
              }`}
            >
              {moreActive ? mark : null}
              <NavIcon name="more" />
              <span>More</span>
            </button>
          </li>
        </ul>
      </nav>

      {open ? (
        <div className="fixed inset-0 z-[70] md:hidden">
          <div
            className="absolute inset-0 bg-black/40"
            style={{ animation: "fadein 200ms both" }}
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
          <div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label={sheetTitle}
            tabIndex={-1}
            className="absolute inset-x-0 bottom-0 max-h-[82dvh] overflow-y-auto rounded-t-[16px] border-t border-line bg-surface pb-[max(16px,env(safe-area-inset-bottom))] outline-none"
            style={{ animation: "pop 260ms cubic-bezier(0.16,1,0.3,1) both" }}
          >
            <div className="sticky top-0 flex items-start gap-3 border-b border-line bg-surface px-[18px] py-3.5">
              <div className="min-w-0 flex-1">
                <div className="truncate text-title font-semibold tracking-head">{sheetTitle}</div>
                {sheetSubtitle ? <div className="mt-1">{sheetSubtitle}</div> : null}
              </div>
              <button type="button" onClick={() => setOpen(false)} className="btn btn-sm flex-none">
                Close
              </button>
            </div>
            {groups.map((group) => (
              <section key={group.title} className="px-2.5 pb-1 pt-3.5" aria-label={group.title}>
                <h2 className="eyebrow m-0 px-2.5 pb-1.5">{group.title}</h2>
                <ul className="m-0 grid list-none gap-px p-0">
                  {group.items.map((item) => (
                    <li key={item.key + item.href}>
                      <Link
                        href={item.href}
                        onClick={() => setOpen(false)}
                        aria-current={item.active ? "page" : undefined}
                        className={`flex items-center gap-3 rounded-[10px] px-2.5 py-3 text-ui ${
                          item.active ? "bg-accent-soft font-medium text-accent-text" : "text-text"
                        }`}
                      >
                        <span className="text-muted">
                          <NavIcon name={item.key} />
                        </span>
                        {item.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </div>
      ) : null}
    </>
  );
}
