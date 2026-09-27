"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { get, post } from "@/lib/api";
import type { MyEventRow, SessionResponse, User } from "@/lib/types";

interface SessionState {
  user: User | null;
  events: MyEventRow[];
  loading: boolean;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<SessionState | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [events, setEvents] = useState<MyEventRow[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const data = await get<SessionResponse>("/auth/session");
      setUser(data.user);
      setEvents(data.events);
    } catch {
      setUser(null);
      setEvents([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const signOut = useCallback(async () => {
    await post("/auth/logout");
    setUser(null);
    setEvents([]);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = useMemo(
    () => ({ user, events, loading, refresh, signOut }),
    [user, events, loading, refresh, signOut],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionState {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used inside SessionProvider.");
  return ctx;
}
