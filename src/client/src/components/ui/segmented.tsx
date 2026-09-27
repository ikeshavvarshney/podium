/**
 * A two-to-four way switch between views or modes: a recessed track with the
 * selected option raised on a surface. Options are toggle buttons, so the
 * selected one is announced with aria-pressed rather than by colour alone.
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  className = "",
}: {
  options: readonly { id: T; label: string; disabled?: boolean }[];
  value: T;
  onChange: (id: T) => void;
  /** Accessible name for the group. */
  label: string;
  /** Layout only, such as a top margin or max width. */
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={`flex gap-0.5 rounded-lg border border-line bg-elevated p-0.5 ${className}`.trim()}
    >
      {options.map((option) => {
        const on = option.id === value;
        return (
          <button
            key={option.id}
            type="button"
            aria-pressed={on}
            disabled={option.disabled}
            onClick={() => onChange(option.id)}
            className="flex-1 cursor-pointer rounded-md px-2.5 py-[9px] text-ui font-medium [transition:background-color_200ms,color_200ms] disabled:opacity-60"
            style={on ? { background: "var(--sf)", color: "var(--tx)" } : { color: "var(--mu)" }}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
