import Link from "next/link";
import type { ReactNode } from "react";

/**
 * One option in a filter group. The selected option is the brand wash, marked
 * with aria-current so it is not colour alone. Filters are links, so they are
 * shareable and work without JavaScript.
 */
export function FilterPill({
  href,
  active,
  count,
  children,
}: {
  href: string;
  active: boolean;
  count?: number;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "true" : undefined}
      className={`pill max-md:py-2 ${
        active ? "border-accent-line bg-accent-soft text-accent-text" : "border-line text-muted hover:border-line-strong hover:text-text"
      }`}
    >
      {children}
      {count === undefined ? null : <span className="ml-1.5 opacity-70">{count}</span>}
    </Link>
  );
}

/** A labelled row of FilterPills, with an "All" option that is selected when nothing else is. */
export function FilterGroup({
  label,
  allHref,
  anySelected,
  children,
}: {
  label: string;
  allHref: string;
  anySelected: boolean;
  children: ReactNode;
}) {
  return (
    <div role="group" aria-label={label}>
      <div className="eyebrow">{label}</div>
      <div className="mt-[11px] flex flex-wrap gap-1.5">
        <FilterPill href={allHref} active={!anySelected}>
          All
        </FilterPill>
        {children}
      </div>
    </div>
  );
}
