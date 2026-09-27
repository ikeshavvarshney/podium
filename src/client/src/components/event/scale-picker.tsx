"use client";

import { clampScale, MAX_SCALE, MIN_SCALE, SCALE_CHOICES } from "@/lib/rubric";

/**
 * "Judges score each criterion out of N". Common scales are one tap; any whole number in
 * range can be typed. The weighted total is computed on each criterion's own range, so the
 * scale changes how fine-grained a ballot is, never how much a criterion counts.
 */
export function ScalePicker({
  value,
  onChange,
  disabled = false,
}: {
  value: number;
  onChange: (scale: number) => void;
  disabled?: boolean;
}) {
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Score out of">
        <span className="text-ui font-medium">Judges score each criterion out of</span>
        {SCALE_CHOICES.map((n) => {
          const on = value === n;
          return (
            <button
              key={n}
              type="button"
              aria-pressed={on}
              disabled={disabled}
              onClick={() => onChange(n)}
              className="pill min-w-[40px] justify-center font-mono disabled:opacity-50"
              style={
                on
                  ? { background: "var(--acs)", color: "var(--act)", borderColor: "var(--ac)" }
                  : undefined
              }
            >
              {n}
            </button>
          );
        })}
        <label className="flex items-center gap-1.5 text-small text-muted">
          or
          <input
            type="number"
            min={MIN_SCALE}
            max={MAX_SCALE}
            step={1}
            value={value}
            disabled={disabled}
            aria-label="Custom scale"
            onChange={(e) => onChange(clampScale(Number(e.target.value)))}
            className="w-[64px] rounded-md border border-line bg-surface px-2 py-1 font-mono text-small outline-none focus:border-muted disabled:opacity-50"
          />
        </label>
      </div>
      <p className="m-0 text-small leading-[1.5] text-muted">
        Scores run 1 to {value}. Weights decide how much each criterion counts; the scale only
        sets how fine-grained a ballot is. It locks with the rubric once scoring starts.
      </p>
    </div>
  );
}
