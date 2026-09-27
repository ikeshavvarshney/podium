"use client";

import { useEffect, useState } from "react";

function format(ms: number): string {
  if (ms <= 0) return "0:00:00:00";
  const total = Math.floor(ms / 1000);
  const days = Math.floor(total / 86400);
  const hours = String(Math.floor((total % 86400) / 3600)).padStart(2, "0");
  const minutes = String(Math.floor((total % 3600) / 60)).padStart(2, "0");
  const seconds = String(total % 60).padStart(2, "0");
  return `${days}:${hours}:${minutes}:${seconds}`;
}

/**
 * Display only. The server decides whether the window is actually open; this
 * just stops the page feeling frozen.
 */
export function Countdown({ deadline, label }: { deadline: string; label: string }) {
  const target = new Date(deadline).getTime();
  // Starts empty and fills after mount: the server clock and the browser clock
  // never agree to the second, and a mismatch would break hydration.
  const [remaining, setRemaining] = useState<number | null>(null);

  useEffect(() => {
    setRemaining(target - Date.now());
    const id = setInterval(() => setRemaining(target - Date.now()), 1000);
    return () => clearInterval(id);
  }, [target]);

  if (remaining === null || remaining <= 0) return null;

  return (
    <div
      title={label}
      className="mt-3 inline-flex items-center gap-[7px] rounded-[10px] bg-elevated px-[9px] py-[5px]"
    >
      <span
        className="h-1.5 w-1.5 flex-none rounded-full bg-accent"
        style={{ animation: "breathe 2.6s ease-in-out infinite" }}
      />
      <span className="font-mono text-small tracking-head tabular-nums">
        {format(remaining)}
      </span>
      <span className="whitespace-nowrap font-mono text-label uppercase tracking-stamp text-muted">
        days:hrs:min:sec left
      </span>
    </div>
  );
}
