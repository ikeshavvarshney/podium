/**
 * The full-page stand-in shown while a screen loads, or when it failed to load.
 * Keeps the eyebrow in place so the user knows where they are either way.
 */
const TITLE = {
  md: "text-page",
  sm: "text-page",
} as const;

export function PageStatus({
  eyebrow,
  error,
  maxWidth,
  size = "md",
}: {
  eyebrow: string;
  error?: string | null;
  /** Tailwind max-width class matching the screen this stands in for, e.g. "max-w-[900px]". */
  maxWidth: string;
  size?: keyof typeof TITLE;
}) {
  return (
    <main className={`screen ${maxWidth} pt-[clamp(26px,4vw,40px)]`}>
      <div className="eyebrow">{eyebrow}</div>
      {error ? (
        <h1 className={`display mt-3.5 ${TITLE[size]}`}>{error}</h1>
      ) : (
        <div className="mt-6 h-28 rounded-xl bg-elevated" />
      )}
    </main>
  );
}
