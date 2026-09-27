"use client";

import Link from "next/link";
import { EventCard } from "@/components/event/event-card";
import { EventNotices } from "@/components/event/event-notices";
import { useSession } from "@/components/providers/session-provider";
import { stepFor, type Phase, type Step } from "@/lib/participant-step";
import type { MyEventRow } from "@/lib/types";
import { useEventStatus } from "@/lib/use-event-status";
import { useNow } from "@/lib/use-now";

const GROUPS: Array<{ phase: Phase; title: string; note: string }> = [
  { phase: "act", title: "Needs you now", note: "Something is due or waiting on you." },
  { phase: "wait", title: "In progress", note: "You are done for now, or the event is between steps." },
  { phase: "done", title: "Finished", note: "Results are out or the event has ended." },
];

/** Secondary links on a card, minus whichever one the step already makes primary. */
function secondaryActions(row: MyEventRow, step: Step) {
  const base = `/events/${row.event.slug}`;
  const links: Array<{ label: string; href: string }> = [];
  if (row.roles.includes("PARTICIPANT")) {
    links.push({ label: "Team", href: `${base}/teams` }, { label: "Submission", href: `${base}/submit` });
  }
  if (row.roles.includes("JUDGE")) links.push({ label: "Scoring queue", href: `${base}/judge` });
  if (row.roles.includes("OWNER") || row.roles.includes("ADMIN")) links.push({ label: "Dashboard", href: `${base}/manage` });
  return links.filter((l) => l.href !== step.action.href);
}

export default function MyEventsPage() {
  const { user, events, loading } = useSession();
  const now = useNow();
  const statusFor = useEventStatus(events);

  if (loading) {
    return (
      <main className="screen max-w-[1180px]">
        <h1 className="display text-hero">My events</h1>
        <div className="mt-8 grid gap-4" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-[148px] rounded-[10px] bg-line"
              style={{ animation: `skeleton-pulse 1.1s ease-in-out infinite ${i * 0.1 + 0.05}s` }}
            />
          ))}
        </div>
      </main>
    );
  }

  if (!user) {
    return (
      <main className="screen max-w-[1180px]">
        <h1 className="display text-hero">Sign in to see your events.</h1>
        <p className="mt-4 max-w-[58ch] text-body leading-[1.6] text-muted">
          Your role is decided per event, so this page only makes sense once we know who you are.
        </p>
        <div className="mt-8 flex flex-wrap gap-2.5">
          <Link href="/auth" className="btn-primary">
            Sign in
          </Link>
          <Link href="/events" className="btn">
            Keep browsing without an account
          </Link>
        </div>
      </main>
    );
  }

  const rows = events.map((row) => {
    const step = stepFor(row.event, row.roles, statusFor(row.event), now);
    return { row, step };
  });
  // Within a group, whatever is due soonest comes first; the rest keep the server's order.
  const soonest = (a: (typeof rows)[number], b: (typeof rows)[number]) => {
    const at = (r: (typeof rows)[number]) => {
      if (r.step.phase !== "act") return Infinity;
      const due = r.row.roles.includes("PARTICIPANT") ? r.row.event.submissionDeadline : r.row.event.judgingClosesAt;
      return due ? new Date(due).getTime() : Infinity;
    };
    return at(a) - at(b);
  };
  const grouped = GROUPS.map((g) => ({ ...g, items: rows.filter((r) => r.step.phase === g.phase).sort(soonest) })).filter(
    (g) => g.items.length > 0,
  );
  const busy = grouped.some((g) => g.phase !== "done");

  return (
    <main className="screen max-w-[1180px]">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
        <div className="min-w-0 flex-[1_1_320px]">
          <h1 className="display text-hero">
            {events.length === 0 ? "You are not in any event yet." : "Your events."}
          </h1>
          <p className="mt-3 max-w-[58ch] text-body leading-[1.6] text-muted">
            Your role is set per event: the same account can compete in one and judge another.
          </p>
        </div>
        {user.isOrganizer ? (
          <Link href="/events/new" className="btn-primary flex-none">
            Create an event
          </Link>
        ) : null}
      </div>

      <EventNotices events={events} />

      {events.length === 0 ? (
        <div className="card mt-[clamp(28px,4vw,38px)] p-[clamp(24px,5vw,40px)] text-ui text-muted">
          <p className="m-0 max-w-[58ch] leading-[1.6]">
            Register for one in the gallery, or open an invite link a teammate sent you: it joins you to
            their team and registers you for the event.
          </p>
          <div className="mt-4 flex flex-wrap gap-2.5">
            <Link href="/events" className={user.isOrganizer ? "btn" : "btn-primary"}>
              Browse events
            </Link>
          </div>
        </div>
      ) : (
        <div className="mt-[clamp(28px,4vw,38px)] grid gap-[clamp(28px,4vw,40px)]">
          {grouped.map((group) => {
            const cards = (
              <div className="grid gap-4">
                {group.items.map(({ row, step }) => (
                  <EventCard
                    key={row.event.id}
                    event={row.event}
                    roles={row.roles}
                    step={step}
                    actions={secondaryActions(row, step).map((l) => (
                      <Link key={l.href} href={l.href} className="btn btn-sm" aria-label={`${l.label}, ${row.event.name}`}>
                        {l.label}
                      </Link>
                    ))}
                  />
                ))}
              </div>
            );
            const heading = (
              <>
                {group.title} <span className="font-normal text-muted">({group.items.length})</span>
              </>
            );
            // Finished events step back once there is something live to attend to.
            if (group.phase === "done" && busy) {
              return (
                <details key={group.phase}>
                  <summary className="cursor-pointer text-title font-semibold tracking-head">{heading}</summary>
                  <div className="mt-4">{cards}</div>
                </details>
              );
            }
            return (
              <section key={group.phase} aria-label={group.title}>
                <h2 className="m-0 mb-1 text-title font-semibold tracking-head">{heading}</h2>
                <p className="m-0 mb-4 text-small text-muted">{group.note}</p>
                {cards}
              </section>
            );
          })}
        </div>
      )}

      {user.isOrganizer && events.length > 0 ? (
        <p className="mt-10 text-small leading-[1.55] text-muted">
          Organizer account. Event creation, the rubric editor and the judging panel are reached from
          inside each event.
        </p>
      ) : null}
    </main>
  );
}
