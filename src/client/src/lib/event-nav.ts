import type { EventDetail } from "@/lib/types";

export interface NavItem {
  key: string;
  href: string;
  label: string;
}

/** The slice of an event the navigation needs. The server still decides what each route allows. */
export type NavEvent = Pick<EventDetail, "slug" | "status" | "resultsPublished" | "viewer">;

const ADMIN_KEYS = ["dashboard", "assign", "rounds", "voting", "results", "updates", "roles", "audit", "settings"] as const;

/**
 * The sections of one event that this viewer can reach, in working order.
 * This only shapes what is offered: every one of these routes is authorized
 * by the server, so a link the viewer should not have would still be refused.
 */
export function eventNav(event: NavEvent): NavItem[] {
  const base = `/events/${event.slug}`;
  const { viewer } = event;
  const at = (key: string, path: string, label: string): NavItem => ({ key, href: `${base}${path}`, label });
  const items: NavItem[] = [at("overview", "", "Overview")];

  if (viewer.isEventAdmin) {
    const admin: Record<(typeof ADMIN_KEYS)[number], NavItem> = {
      dashboard: at("dashboard", "/manage", "Dashboard"),
      assign: at("assign", "/assign", "Assign judges"),
      rounds: at("rounds", "/rounds", "Rounds"),
      voting: at("voting", "/voting", "Voting"),
      results: at("results", "/results", "Results"),
      updates: at("updates", "/updates", "Updates"),
      roles: at("roles", "/roles", "Roles"),
      audit: at("audit", "/audit", "Audit"),
      settings: at("settings", "/settings", "Settings"),
    };
    for (const key of ADMIN_KEYS) items.push(admin[key]);
  }
  if (viewer.isJudge) items.push(at("judge", "/judge", "Scoring"));
  if (viewer.isParticipant) {
    items.push(at("submit", "/submit", "My project"), at("teams", "/teams", "Team"));
    if (!viewer.isEventAdmin) items.push(at("updates", "/updates", "Updates"));
  }
  if (!viewer.isEventAdmin && !viewer.isJudge && !viewer.isParticipant) {
    items.push(at("register", "/register", "Register"));
  }
  if (event.status === "VOTING" && !viewer.isEventAdmin) items.push(at("vote", "/vote", "Vote"));
  if (event.resultsPublished) items.push(at("winners", "/winners", "Winners"));
  return items;
}

/** The few destinations a phone keeps within thumb reach; everything else lives under More. */
export function primaryKeys(event: NavEvent): string[] {
  const { viewer } = event;
  if (viewer.isEventAdmin) return ["dashboard", "assign", "results"];
  if (viewer.isJudge) return ["overview", "judge", viewer.isParticipant ? "submit" : "winners"];
  if (viewer.isParticipant) return ["overview", "submit", "teams"];
  return ["overview", event.status === "VOTING" ? "vote" : "register", "winners"];
}

export function isActive(pathname: string, item: NavItem): boolean {
  if (item.key === "overview") return pathname === item.href;
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

/** The label for this viewer's standing in the event. Event-scoped, never global. */
export function roleLabels(event: NavEvent): string[] {
  const { viewer } = event;
  const labels: string[] = [];
  if (viewer.isOwner) labels.push("Owner");
  else if (viewer.isEventAdmin) labels.push("Admin");
  if (viewer.isJudge) labels.push("Judge");
  if (viewer.isParticipant) labels.push("Participant");
  return labels.length > 0 ? labels : ["Visitor"];
}

/** Matches /events/<slug> and its sub-routes, but not /events/new. */
export function eventSlugOf(pathname: string): string | null {
  const m = /^\/events\/([^/]+)(?:\/|$)/.exec(pathname);
  return m && m[1] !== "new" ? m[1]! : null;
}
