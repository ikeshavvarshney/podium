/**
 * A post-sign-in destination is only trusted when it is a path on this site.
 * Anything else (another origin, a protocol-relative "//host", a backslash
 * trick) falls back to the given default.
 */
export function safeNext(value: string | null | undefined, fallback = "/my-events"): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return fallback;
  return value;
}
