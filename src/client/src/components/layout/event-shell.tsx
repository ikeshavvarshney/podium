"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { BottomBar, type BarItem, type SheetGroup } from "@/components/layout/bottom-bar";
import { useSession } from "@/components/providers/session-provider";
import { useShell } from "@/components/providers/shell-context";
import { StatusChip } from "@/components/ui/status-chip";
import { get } from "@/lib/api";
import { eventNav, isActive, primaryKeys, roleLabels, type NavItem } from "@/lib/event-nav";
import { hue, ROLE_HUE, STATUS_HUE, STATUS_LABEL } from "@/lib/hues";
import type { EventDetail } from "@/lib/types";

const ROLE_TONE: Record<string, string> = {
  Owner: ROLE_HUE.OWNER!,
  Admin: ROLE_HUE.ADMIN!,
  Judge: ROLE_HUE.JUDGE!,
  Participant: ROLE_HUE.PARTICIPANT!,
  Visitor: ROLE_HUE.VISITOR!,
};

/** The one button that moves this viewer forward, by role. Null when they are already there. */
function nextAction(event: EventDetail, items: NavItem[], pathname: string): { href: string; label: string } | null {
  const has = (key: string) => items.find((i) => i.key === key);
  const { viewer } = event;
  let pick: { item: NavItem | undefined; label: string };
  if (viewer.isEventAdmin) pick = { item: has("dashboard"), label: "Open dashboard" };
  else if (viewer.isJudge) pick = { item: has("judge"), label: "Open scoring queue" };
  else if (event.status === "VOTING" && has("vote")) pick = { item: has("vote"), label: "Open the ballot" };
  else if (viewer.isParticipant) pick = { item: has("submit"), label: "Continue your project" };
  else pick = { item: has("register"), label: "Register" };
  if (!pick.item || isActive(pathname, pick.item)) return null;
  return { href: pick.item.href, label: pick.label };
}

function RoleChips({ event }: { event: EventDetail }) {
  return (
    <>
      {roleLabels(event).map((role) => {
        const tone = hue(ROLE_TONE[role] ?? "neutral");
        return (
          <span
            key={role}
            className="chip whitespace-nowrap uppercase tracking-stamp"
            style={{ background: tone.bg, color: tone.fg }}
            title="Your role in this event only"
          >
            {role}
          </span>
        );
      })}
    </>
  );
}

/**
 * Wraps every screen under /events/<slug>. It answers, on every one of them:
 * which event this is, what standing the viewer has in it, where they are in
 * it, and what to do next. The roles come from the same server response the
 * pages use; nothing here grants access.
 */
export function EventShell({ slug, children }: { slug: string; children: ReactNode }) {
  const pathname = usePathname();
  const { user, loading } = useSession();
  const { setEvent } = useShell();
  const [event, setLocal] = useState<EventDetail | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (loading) return;
    let live = true;
    get<EventDetail>(`/events/${slug}`)
      .then((data) => {
        if (!live) return;
        setLocal(data);
        setFailed(false);
      })
      .catch(() => {
        if (!live) return;
        setLocal(null);
        setFailed(true);
      });
    return () => {
      live = false;
    };
    // Refetched on navigation so a role granted a moment ago shows up without a reload.
  }, [slug, pathname, user?.id, loading]);

  useEffect(() => {
    if (event) {
      setEvent({ slug: event.slug, name: event.name, status: event.status, roles: roleLabels(event) });
    } else {
      setEvent(null, failed);
    }
    return () => setEvent(null);
  }, [event, failed, setEvent]);

  if (!event) {
    return (
      <>
        {failed ? null : <div className="hidden h-[46px] border-b border-line md:block" aria-hidden="true" />}
        {children}
      </>
    );
  }

  const items = eventNav(event);
  const base = `/events/${event.slug}`;
  const onOverview = pathname === base;
  const status = hue(STATUS_HUE[event.status] ?? "neutral");
  const next = nextAction(event, items, pathname);

  const primary = primaryKeys(event)
    .map((key) => items.find((i) => i.key === key))
    .filter((i): i is NavItem => Boolean(i));
  const bar: BarItem[] = primary.map((i) => ({ ...i, active: isActive(pathname, i) }));
  const groups: SheetGroup[] = [
    { title: "This event", items: items.map((i) => ({ ...i, active: isActive(pathname, i) })) },
    {
      title: "podium",
      items: [
        { key: "discover", href: "/events", label: "All events", active: false },
        ...(user ? [{ key: "my-events", href: "/my-events", label: "My events", active: false }] : []),
        ...(user?.isOrganizer ? [{ key: "events", href: "/organizer", label: "Events I run", active: false }] : []),
      ],
    },
  ];

  return (
    <>
      <div className="print:hidden max-md:hidden">
        {onOverview ? null : (
          <div className="border-b border-line bg-surface">
            <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-x-4 gap-y-2.5 px-[clamp(18px,4vw,28px)] py-3">
              <nav aria-label="Breadcrumb" className="flex min-w-0 flex-1 items-center gap-2 text-ui">
                <Link href="/events" className="flex flex-none items-center text-muted transition-colors hover:text-text [@media(pointer:coarse)]:min-h-[44px]">
                  All events
                </Link>
                <span className="flex-none text-muted" aria-hidden="true">
                  /
                </span>
                <Link href={base} className="flex min-w-0 items-center truncate font-semibold tracking-head hover:underline [@media(pointer:coarse)]:min-h-[44px]">
                  {event.name}
                </Link>
                <StatusChip hue={status} className="flex-none whitespace-nowrap">
                  {STATUS_LABEL[event.status] ?? event.status}
                </StatusChip>
              </nav>
              <div className="flex flex-none flex-wrap items-center gap-2">
                <span className="text-meta font-mono text-muted">Your role here</span>
                <RoleChips event={event} />
              </div>
              {next ? (
                <Link href={next.href} className="btn-primary btn-sm flex-none">
                  {next.label}
                </Link>
              ) : null}
            </div>
          </div>
        )}
        <div
          className="sticky top-[54px] z-30 border-b border-line"
          style={{ background: "var(--hd)", backdropFilter: "blur(20px) saturate(180%)", WebkitBackdropFilter: "blur(20px) saturate(180%)" }}
        >
          <nav
            aria-label={`${event.name} sections`}
            className="mx-auto flex max-w-[1400px] gap-x-1 overflow-x-auto px-[clamp(18px,4vw,28px)]"
          >
            {items.map((item) => {
              const active = isActive(pathname, item);
              return (
                <Link
                  key={item.key}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={`flex items-center whitespace-nowrap border-b-2 px-2.5 pb-[11px] pt-[11px] text-ui transition-colors duration-200 [@media(pointer:coarse)]:min-h-[48px] ${
                    active ? "border-accent font-medium text-text" : "border-transparent text-muted hover:text-text"
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>
      </div>

      {children}

      <BottomBar
        label={`${event.name} navigation`}
        items={bar}
        sheetTitle={event.name}
        sheetSubtitle={
          <div className="flex flex-wrap items-center gap-1.5">
            <StatusChip hue={status}>{STATUS_LABEL[event.status] ?? event.status}</StatusChip>
            <RoleChips event={event} />
            <span className="text-small text-muted">in this event only</span>
          </div>
        }
        groups={groups}
      />
    </>
  );
}
