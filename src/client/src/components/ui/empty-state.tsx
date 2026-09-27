import type { ReactNode } from "react";

/**
 * A card standing in for content that is missing or failed to load. With an
 * `action` it becomes a dead end with a way out, such as "Back to the event".
 */
export function EmptyState({
  tone = "muted",
  action,
  className = "",
  children,
}: {
  tone?: "muted" | "danger";
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  const color = tone === "danger" ? "text-danger" : "text-muted";
  return (
    <div className={`card bg-dots p-10 text-center text-body ${color} ${className}`.trim()}>
      {action ? (
        <>
          <p className="m-0">{children}</p>
          <div className="mt-6">{action}</div>
        </>
      ) : (
        children
      )}
    </div>
  );
}
