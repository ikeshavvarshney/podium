"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { get } from "@/lib/api";
import type { MyEventRow } from "@/lib/types";

interface Prefs {
  judgingReminders: boolean;
  resultsPublished: boolean;
  voteDigest: boolean;
}

interface Notice {
  key: string;
  text: string;
  href: string;
  cta: string;
}

const DAY = 24 * 60 * 60 * 1000;

/**
 * In-app notices, gated by the account's notification preferences. The
 * platform sends no email, so this is where those preferences take effect.
 */
export function EventNotices({ events }: { events: MyEventRow[] }) {
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    setNow(Date.now());
    get<Prefs>("/auth/me/notifications").then(setPrefs).catch(() => setPrefs(null));
  }, []);

  if (!prefs || now === null) return null;

  const notices: Notice[] = [];
  for (const { event, roles } of events) {
    const judgingCloses = event.judgingClosesAt ? new Date(event.judgingClosesAt).getTime() : null;
    const votingCloses = event.votingClosesAt ? new Date(event.votingClosesAt).getTime() : null;

    if (prefs.judgingReminders && roles.includes("JUDGE") && judgingCloses && judgingCloses > now && judgingCloses - now < 2 * DAY) {
      const hours = Math.max(1, Math.round((judgingCloses - now) / 3_600_000));
      notices.push({
        key: `judge-${event.id}`,
        text: `Judging for ${event.name} closes in ${hours} hour${hours === 1 ? "" : "s"}.`,
        href: `/events/${event.slug}/judge`,
        cta: "Open queue",
      });
    }
    if (prefs.resultsPublished && event.resultsPublished) {
      notices.push({
        key: `results-${event.id}`,
        text: `Results for ${event.name} are published.`,
        href: `/events/${event.slug}/winners`,
        cta: "See winners",
      });
    }
    if (prefs.voteDigest && roles.includes("PARTICIPANT") && votingCloses && votingCloses < now) {
      notices.push({
        key: `votes-${event.id}`,
        text: `Community voting for ${event.name} has closed.`,
        href: `/events/${event.slug}/winners`,
        cta: "See the tally",
      });
    }
  }

  if (notices.length === 0) return null;

  return (
    <div role="status" aria-label="Notices" className="mt-6 grid gap-2">
      {notices.map((n, i) => (
        <div
          key={n.key}
          className="flex flex-wrap items-center gap-3 rounded-[10px] border px-4 py-3"
          style={{
            borderColor: "var(--ac)",
            background: "var(--acs)",
            animation: `pop 420ms cubic-bezier(0.16,1,0.3,1) ${i * 60}ms both`,
          }}
        >
          <span aria-hidden="true" className="h-[7px] w-[7px] flex-none rounded-full bg-accent" />
          <span className="min-w-0 flex-1 text-ui text-accent-text">{n.text}</span>
          <Link href={n.href} className="btn btn-sm bg-surface">
            {n.cta}
          </Link>
        </div>
      ))}
    </div>
  );
}
