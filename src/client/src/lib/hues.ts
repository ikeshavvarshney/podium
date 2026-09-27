/**
 * Tones: the six background and foreground pairs the interface uses for chips,
 * tags and avatars. They resolve to the --tone-* tokens in globals.css, so a
 * theme change remaps them. Colour is never the only signal: every chip also
 * carries a text label.
 *
 *   neutral  inactive, draft, closed, unclassified
 *   brand    selected, current, identity (organizer, judge)
 *   info     upcoming, informational
 *   success  open, complete, valid
 *   warning  needs attention, in progress
 *   danger   failed, destructive, disqualified
 */
const TONE_NAMES = ["neutral", "brand", "info", "success", "warning", "danger"] as const;

export type ToneName = (typeof TONE_NAMES)[number];

/** Names from the design prototype. Deprecated; existing data (avatar colours) still carries them. */
const LEGACY_HUES = {
  slate: "neutral",
  coral: "neutral",
  teal: "brand",
  plum: "brand",
  blue: "info",
  cyan: "info",
  green: "success",
  amber: "warning",
  rose: "danger",
} as const satisfies Record<string, ToneName>;

export type LegacyHue = keyof typeof LEGACY_HUES;
export const HUE_NAMES = [...TONE_NAMES, ...(Object.keys(LEGACY_HUES) as LegacyHue[])] as const;
export type HueName = ToneName | LegacyHue;

function toneOf(name: string): ToneName {
  if ((TONE_NAMES as readonly string[]).includes(name)) return name as ToneName;
  return (LEGACY_HUES as Record<string, ToneName>)[name] ?? "neutral";
}

export function hue(name: string): { bg: string; fg: string } {
  const tone = toneOf(name);
  return { bg: `var(--tone-${tone}-bg)`, fg: `var(--tone-${tone}-fg)` };
}

/** Event lifecycle. */
export const STATUS_HUE: Record<string, ToneName> = {
  DRAFT: "neutral",
  PUBLISHED: "info",
  REGISTRATION_OPEN: "success",
  SUBMISSIONS_OPEN: "success",
  JUDGING: "warning",
  VOTING: "brand",
  RESULTS_PUBLISHED: "brand",
  ARCHIVED: "neutral",
};

export const STATUS_LABEL: Record<string, string> = {
  DRAFT: "Draft",
  PUBLISHED: "Announced",
  REGISTRATION_OPEN: "Registration open",
  SUBMISSIONS_OPEN: "Submissions open",
  JUDGING: "Judging open",
  VOTING: "Community voting",
  RESULTS_PUBLISHED: "Results published",
  ARCHIVED: "Archived",
};

export const ROLE_HUE: Record<string, ToneName> = {
  PUBLIC: "neutral",
  USER: "neutral",
  VISITOR: "neutral",
  PARTICIPANT: "neutral",
  JUDGE: "info",
  ORGANIZER: "brand",
  OWNER: "brand",
  ADMIN: "brand",
};

/** Deterministic cover tone for an event, track or person, from its name. */
export function coverHue(seed: string): ToneName {
  let total = 0;
  for (let i = 0; i < seed.length; i += 1) total += seed.charCodeAt(i);
  // Quiet variety only: never a status colour, so a card is not read as a state.
  const palette: ToneName[] = ["neutral", "brand", "info"];
  return palette[total % palette.length]!;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "??";
  const first = parts[0]![0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1]![0] : (parts[0]![1] ?? "");
  return (first + last).toUpperCase();
}
