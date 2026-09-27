import Link from "next/link";
import type { ReactNode } from "react";

/**
 * The head of a working screen: an optional way back to the parent section,
 * an eyebrow for the screen's context, the title, a lead, and the actions that
 * belong to the screen. The event name and the viewer's role are not repeated
 * here; the event shell above already carries them.
 */
export function PageHeader({
  back,
  eyebrow,
  title,
  lead,
  actions,
}: {
  back?: { href: string; label: string };
  eyebrow?: ReactNode;
  title: ReactNode;
  lead?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header>
      {back ? (
        <Link href={back.href} className="eyebrow mb-4 inline-flex items-center gap-[7px] hover:text-text max-md:min-h-[44px] [@media(pointer:coarse)]:min-h-[44px]">
          <svg
            viewBox="0 0 24 24"
            width="12"
            height="12"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M14 6l-6 6 6 6" />
          </svg>
          {back.label}
        </Link>
      ) : null}
      {eyebrow ? (
        <div className="eyebrow flex items-center gap-2">
          <i className="h-2 w-2 flex-none rounded-[2px] bg-accent" aria-hidden="true" />
          {eyebrow}
        </div>
      ) : null}
      <div className={`${eyebrow ? "mt-3 " : ""}flex flex-wrap items-end justify-between gap-x-6 gap-y-[18px]`}>
        <div className="min-w-0 flex-[1_1_320px]">
          <h1 className="display text-page">{title}</h1>
          {lead ? <p className="mt-3 max-w-[60ch] text-body leading-[1.6] text-muted">{lead}</p> : null}
        </div>
        {actions ? <div className="flex max-w-full flex-wrap gap-2">{actions}</div> : null}
      </div>
    </header>
  );
}
