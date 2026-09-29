export const EVENT_AREAS = [
  { id: "SETTINGS", label: "Event settings", hint: "Details, dates, tracks, prizes, questions, people, FAQ and publishing" },
  { id: "ROUNDS", label: "Rounds", hint: "Open, close and schedule rounds" },
  { id: "ROLES", label: "Judges and roster", hint: "Add or remove judges and import rosters" },
  { id: "JUDGING", label: "Judging", hint: "Rubric, judge assignments and judging progress" },
  { id: "RESULTS", label: "Results", hint: "Compute and publish results, certificates" },
  { id: "VOTING", label: "Community voting", hint: "Voting setup and every ballot" },
  { id: "SUBMISSIONS", label: "Submissions", hint: "All entries, locking, flagging and comment moderation" },
  { id: "UPDATES", label: "Announcements", hint: "Post and edit event updates" },
  { id: "INTEGRATIONS", label: "Integrations and exports", hint: "Webhooks and data exports" },
  { id: "AUDIT", label: "Audit log", hint: "Read the event's audit log" },
] as const;

export type EventArea = (typeof EVENT_AREAS)[number]["id"];

type ViewerAccess = { isEventAdmin: boolean; fullAccess?: boolean; permissions?: string[] };

/** Whether this admin may use an organizer area. The server enforces the same rule on every request. */
export function can(viewer: ViewerAccess, area: EventArea): boolean {
  if (!viewer.isEventAdmin) return false;
  if (viewer.fullAccess || viewer.permissions === undefined) return true;
  return viewer.permissions.includes(area);
}
