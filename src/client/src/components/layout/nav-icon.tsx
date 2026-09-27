/** Small stroked icons for the mobile bar, one per destination. Decorative: the label always accompanies them. */
const PATHS: Record<string, string> = {
  overview: "M4 11.2 12 4.5l8 6.7V19a1 1 0 0 1-1 1h-4.5v-5.5h-5V20H5a1 1 0 0 1-1-1z",
  dashboard: "M4 5h7v7H4zM13 5h7v4h-7zM13 11h7v8h-7zM4 14h7v5H4z",
  results: "M5 20V11M12 20V5M19 20v-7",
  scoring: "M12 4.2l2.4 4.9 5.4.8-3.9 3.8.9 5.4-4.8-2.5-4.8 2.5.9-5.4L4.2 9.9l5.4-.8z",
  project: "M6 3.8h9l3 3V20H6zM14.5 3.8V7H18M9 11.5h6M9 15h6",
  team: "M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM3.5 19c.6-3 2.7-4.5 5.5-4.5s4.9 1.5 5.5 4.5M16 11a2.5 2.5 0 1 0 0-5M17.5 14.6c1.7.4 2.7 1.7 3 4",
  register: "M12 5v14M5 12h14",
  vote: "M5 12.5l4.5 4.5L19 7.5",
  winners: "M8 4h8v4.5a4 4 0 0 1-8 0zM8 6H5v1.5A3 3 0 0 0 8 10.5M16 6h3v1.5a3 3 0 0 1-3 3M12 12.5V16M8.5 20h7M10 16h4",
  discover: "M12 20.5a8.5 8.5 0 1 0 0-17 8.5 8.5 0 0 0 0 17zM15.4 8.6l-2 5-5 2 2-5z",
  events: "M5 6.5h14M5 12h14M5 17.5h9",
  more: "M6 12h.01M12 12h.01M18 12h.01",
};

const ALIASES: Record<string, string> = {
  judge: "scoring",
  submit: "project",
  teams: "team",
  assign: "team",
  rounds: "events",
  voting: "vote",
  updates: "events",
  roles: "team",
  settings: "dashboard",
  "my-events": "events",
};

export function NavIcon({ name }: { name: string }) {
  const d = PATHS[ALIASES[name] ?? name] ?? PATHS.overview!;
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={d} />
    </svg>
  );
}
