import type { CSSProperties, ReactNode } from "react";

const TONE = {
  success: "bg-success-soft text-success-text",
  danger: "bg-danger-soft text-danger",
} as const;

/**
 * The small uppercase mono tag. Give it a named hue pair from `lib/hues` for
 * status or role, or a `tone` for a saved/error flag.
 */
export function StatusChip({
  hue,
  tone,
  title,
  className = "",
  children,
}: {
  hue?: { bg: string; fg: string };
  tone?: keyof typeof TONE;
  title?: string;
  className?: string;
  children: ReactNode;
}) {
  const style: CSSProperties | undefined = hue ? { background: hue.bg, color: hue.fg } : undefined;
  const classes = ["status-chip", tone ? TONE[tone] : "", className].filter(Boolean).join(" ");
  return (
    <span className={classes} style={style} title={title}>
      {children}
    </span>
  );
}
