import type { ReactNode } from "react";

const TONE = {
  danger: { classes: "bg-danger-soft text-danger", role: "alert" },
  success: { classes: "bg-success-soft text-success-text", role: "status" },
} as const;

/** An inline result banner: an error to fix ("danger") or a confirmation ("success"). */
export function Notice({
  tone = "danger",
  className = "",
  children,
}: {
  tone?: keyof typeof TONE;
  /** Layout only, such as a top margin. */
  className?: string;
  children: ReactNode;
}) {
  const { classes, role } = TONE[tone];
  return (
    <div role={role} className={`rounded-[10px] px-[13px] py-2.5 text-small ${classes} ${className}`.trim()}>
      {children}
    </div>
  );
}
