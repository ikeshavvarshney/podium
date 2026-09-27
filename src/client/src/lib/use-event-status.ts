"use client";

import { useEffect, useMemo, useState } from "react";
import { get } from "@/lib/api";
import { needsStatusFetch, type StepData } from "@/lib/participant-step";
import type { EventSummary, MyEventRow } from "@/lib/types";

type Fetched = Record<string, StepData>;

/**
 * Loads the team and submission a participant needs to see per event, using
 * the same endpoints the team and submission pages use. Only events that are
 * still live are fetched. A failed fetch reads as "not started", so the
 * dashboard errs toward prompting rather than reassuring.
 */
export function useEventStatus(rows: MyEventRow[]): (event: EventSummary) => StepData {
  const [fetched, setFetched] = useState<Fetched>({});
  const key = useMemo(
    () =>
      rows
        .filter((r) => needsStatusFetch(r.event, r.roles))
        .map((r) => r.event.slug)
        .join("|"),
    [rows],
  );

  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    for (const slug of key.split("|")) {
      Promise.all([
        get<{ members: unknown[] } | null>(`/events/${slug}/teams/mine`).catch(() => null),
        get<{ submission: { status: string } | null }>(`/events/${slug}/submissions/mine`).catch(() => null),
      ]).then(([team, mine]) => {
        if (cancelled) return;
        setFetched((prev) => ({
          ...prev,
          [slug]: {
            loaded: true,
            team: team ? { members: team.members.length } : null,
            submission: mine?.submission ? { status: mine.submission.status } : null,
          },
        }));
      });
    }
    return () => {
      cancelled = true;
    };
  }, [key]);

  return (event) => fetched[event.slug] ?? { loaded: !needsStatusFetch(event, ["PARTICIPANT"]), team: null, submission: null };
}
