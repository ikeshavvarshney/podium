/** The prototype's loading screen: a shimmering stand-in with the same rhythm. */
export function ScreenSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div>
      <div className="skeleton h-[11px] w-[130px] rounded" />
      <div className="skeleton mt-4 h-[30px] w-[46%] max-w-[420px] rounded-md" />
      <div className="mt-[clamp(28px,4vw,38px)] grid gap-3">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="skeleton h-[84px] rounded-[14px] border border-line" />
        ))}
      </div>
    </div>
  );
}
