"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { EventStatus } from "@/lib/types";

/** What the application header needs to know about the event currently open. */
export interface ShellEvent {
  slug: string;
  name: string;
  status: EventStatus;
  roles: string[];
}

interface ShellState {
  event: ShellEvent | null;
  /** True when a route under /events/<slug> could not load its event (missing or private). */
  eventFailed: boolean;
  setEvent: (event: ShellEvent | null, failed?: boolean) => void;
}

const ShellContext = createContext<ShellState>({ event: null, eventFailed: false, setEvent: () => {} });

const same = (a: ShellEvent | null, b: ShellEvent | null) =>
  a === b ||
  (a !== null &&
    b !== null &&
    a.slug === b.slug &&
    a.name === b.name &&
    a.status === b.status &&
    a.roles.join("|") === b.roles.join("|"));

export function ShellProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<{ event: ShellEvent | null; eventFailed: boolean }>({
    event: null,
    eventFailed: false,
  });

  // Stable identity, and a no-op when nothing changed, so an effect that calls it cannot loop.
  const setEvent = useCallback((event: ShellEvent | null, failed = false) => {
    setState((prev) => (same(prev.event, event) && prev.eventFailed === failed ? prev : { event, eventFailed: failed }));
  }, []);

  const value = useMemo<ShellState>(() => ({ ...state, setEvent }), [state, setEvent]);
  return <ShellContext.Provider value={value}>{children}</ShellContext.Provider>;
}

export const useShell = () => useContext(ShellContext);
