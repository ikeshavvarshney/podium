"use client";

import { usePathname } from "next/navigation";
import { BottomBar, type BarItem } from "@/components/layout/bottom-bar";
import { useSession } from "@/components/providers/session-provider";
import { useShell } from "@/components/providers/shell-context";
import { eventSlugOf } from "@/lib/event-nav";

/**
 * The phone navigation outside an event. Inside an event the event shell owns
 * the bar instead, so the destinations always match where the user is working.
 */
export function AppMobileNav() {
  const pathname = usePathname();
  const { user } = useSession();
  const { event, eventFailed } = useShell();

  if (pathname.startsWith("/embed/") || pathname.startsWith("/auth")) return null;
  // Inside an event the shell bar takes over, unless the event could not load at all.
  if (eventSlugOf(pathname) && !eventFailed) return null;
  if (event) return null;

  const items: BarItem[] = [
    { key: "discover", href: "/events", label: "Discover", active: pathname === "/events" || pathname.startsWith("/events/") },
    ...(user
      ? [{ key: "my-events", href: "/my-events", label: "My events", active: pathname.startsWith("/my-events") }]
      : []),
    ...(user?.isOrganizer
      ? [{ key: "events", href: "/organizer", label: "Organizing", active: pathname.startsWith("/organizer") }]
      : []),
  ];

  return (
    <BottomBar
      label="Main"
      items={items}
      sheetTitle="podium"
      groups={[
        {
          title: "Account",
          items: user
            ? [
                { key: "team", href: "/profile", label: "Profile and password", active: pathname.startsWith("/profile") },
                { key: "dashboard", href: "/settings", label: "Appearance", active: pathname.startsWith("/settings") },
              ]
            : [{ key: "register", href: "/auth", label: "Sign in", active: false }],
        },
        {
          title: "Platform",
          items: [
            { key: "overview", href: "/", label: "About", active: false },
            ...(user?.isOrganizer ? [{ key: "register", href: "/events/new", label: "Create an event", active: false }] : []),
            { key: "winners", href: "/verify", label: "Verify a record", active: false },
          ],
        },
      ]}
    />
  );
}
