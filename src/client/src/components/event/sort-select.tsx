"use client";

import { useRouter, useSearchParams } from "next/navigation";

/**
 * The prototype's sort control. Kept as a native select for visual fidelity;
 * selecting navigates so the sort survives a refresh and a shared link.
 */
export function SortSelect({
  options,
}: {
  options: Array<{ value: string; label: string }>;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const current = params.get("sort") ?? options[0]?.value ?? "recent";

  return (
    <label className="inline-flex flex-none items-center gap-[9px]">
      <span className="eyebrow">Sort</span>
      <select
        value={current}
        aria-label="Sort events"
        onChange={(e) => {
          const next = new URLSearchParams(params.toString());
          next.set("sort", e.target.value);
          router.push(`/events?${next.toString()}`);
        }}
        className="cursor-pointer appearance-none rounded-[10px] border border-line bg-surface py-[10px] pl-[13px] pr-[30px] text-ui text-text transition-colors duration-200 hover:border-muted"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
