/** What an event admin can be allowed to do. An owner, a super admin, or an admin holding FULL_ACCESS can do all of it. */
export const EVENT_AREAS = [
  "SETTINGS",
  "ROUNDS",
  "ROLES",
  "JUDGING",
  "RESULTS",
  "VOTING",
  "SUBMISSIONS",
  "UPDATES",
  "INTEGRATIONS",
  "AUDIT",
] as const;

export type EventArea = (typeof EVENT_AREAS)[number];

export const FULL_ACCESS = "ALL";

export function isEventArea(value: string): value is EventArea {
  return (EVENT_AREAS as readonly string[]).includes(value);
}
