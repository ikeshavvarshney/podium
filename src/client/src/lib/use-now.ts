"use client";

import { useEffect, useState } from "react";

/**
 * The current time, or null before the page has mounted. Server and browser
 * clocks never agree to the second, so time-left text waits for the client
 * rather than risk a hydration mismatch. Refreshes every minute.
 */
export function useNow(intervalMs = 60_000): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
