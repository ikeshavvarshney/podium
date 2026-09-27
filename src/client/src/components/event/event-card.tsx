import Link from "next/link";
import { coverHue, hue, STATUS_HUE, STATUS_LABEL } from "@/lib/hues";
import { timeLeft, type Step } from "@/lib/participant-step";
import type { EventSummary } from "@/lib/types";
import { StatusChip } from "@/components/ui/status-chip";

const MODE_LABEL: Record<string, string> = {
  ONLINE: "Online · Remote",
  IN_PERSON: "In-person",
  HYBRID: "Hybrid",
};

function dateRange(event: EventSummary): string {
  const start = event.submissionsOpenAt ?? event.registrationClosesAt;
  const end = event.submissionDeadline;
  if (!start && !end) return "dates to be announced";
  const fmt = (iso: string) =>
    new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  if (start && end) {
    const year = new Date(end).getFullYear();
    return `${fmt(start)}-${fmt(end)}, ${year}`;
  }
  return fmt((start ?? end)!);
}

function money(cents: number | undefined, currency: string | undefined): string | null {
  if (!cents) return null;
  return `${new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: currency ?? "USD",
    maximumFractionDigits: 0,
  }).format(cents / 100)} prize pool`;
}

/** Days until registration closes, which is what a visitor is deciding on. */
function closesIn(event: EventSummary): string {
  const raw = event.registrationClosesAt ?? event.submissionDeadline;
  if (!raw) return "";
  const ms = new Date(raw).getTime() - Date.now();
  const label = event.registrationClosesAt ? "Registration closes" : "Submissions close";
  if (ms <= 0) return event.registrationClosesAt ? "Registration closed" : "Submissions closed";
  const when = new Date(raw).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  if (ms < 2 * 86_400_000) return `${label} ${when} · ${timeLeft(ms)}`;
  const days = Math.ceil(ms / 86_400_000);
  return `${label} ${when} · ${days} days`;
}

function RoleChips({ roles }: { roles: string[] }) {
  return (
    <span className="ml-auto flex flex-wrap gap-1.5">
      {roles.map((role) => (
        <span key={role} className="chip bg-elevated uppercase tracking-stamp text-muted">
          <span className="sr-only">Your role in this event: </span>
          {role.toLowerCase()}
        </span>
      ))}
    </span>
  );
}

/**
 * An event as one person sees it on their dashboard: what state it is in for
 * them, the one thing to do, and only the facts that help them do it. The
 * discovery card below is for visitors deciding whether to join.
 */
function DashboardCard({
  event,
  roles,
  step,
  actions,
}: {
  event: EventSummary;
  roles: string[];
  step: Step;
  actions?: React.ReactNode;
}) {
  const cover = hue(coverHue(event.name));
  const status = hue(STATUS_HUE[event.status] ?? "slate");
  const quiet = step.phase === "done";

  return (
    <article className="card lift flex flex-wrap overflow-hidden">
      <div
        className="grid flex-[0_0_64px] place-items-center font-mono text-figure max-sm:hidden"
        style={{ background: cover.bg, color: cover.fg }}
        aria-hidden="true"
      >
        {event.name.trim()[0]?.toUpperCase() ?? "?"}
      </div>

      <div className="min-w-0 flex-[1_1_320px] p-[clamp(16px,2.4vw,22px)]">
        <div className="flex flex-wrap items-baseline gap-2.5">
          <h2 className="m-0 text-title font-semibold tracking-head">
            <Link href={`/events/${event.slug}`} className="underline-offset-4 hover:underline">
              {event.name}
            </Link>
          </h2>
          <StatusChip hue={status}>{STATUS_LABEL[event.status] ?? event.status}</StatusChip>
          <RoleChips roles={roles} />
        </div>

        <p className={`mt-3 max-w-[62ch] text-body leading-[1.55] [text-wrap:pretty] ${quiet ? "text-muted" : "font-medium"}`}>
          {step.sentence}
        </p>
        {step.deadline ? (
          <p
            className={`mt-2 inline-block rounded-[5px] px-2 py-1 font-mono text-meta leading-[1.5] ${
              step.urgent ? "bg-warning-soft text-warning-text" : "text-muted"
            }`}
          >
            {step.deadline}
          </p>
        ) : null}

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Link
            href={step.action.href}
            className={`${quiet ? "btn" : "btn-primary"} btn-sm`}
            aria-label={`${step.action.label}, ${event.name}`}
          >
            {step.action.label}
          </Link>
          {actions}
          <Link href={`/events/${event.slug}?tab=Gallery`} className="btn btn-sm" aria-label={`Gallery, ${event.name}`}>
            Gallery
          </Link>
          {event.resultsPublished ? (
            <Link href={`/events/${event.slug}/winners`} className="btn btn-sm" aria-label={`Winners, ${event.name}`}>
              Winners
            </Link>
          ) : null}
        </div>
      </div>
    </article>
  );
}

export function EventCard({
  event,
  roles,
  actions,
  step,
}: {
  event: EventSummary;
  roles?: string[];
  actions?: React.ReactNode;
  /** When given, the card is the dashboard variant built around this step. */
  step?: Step;
}) {
  if (step && roles) return <DashboardCard event={event} roles={roles} step={step} actions={actions} />;

  const cover = hue(coverHue(event.name));
  const status = hue(STATUS_HUE[event.status] ?? "slate");
  const pool = money(event.prizePoolCents, event.currency);

  return (
    <article className="card lift flex flex-wrap overflow-hidden">
      <div
        className="grid min-h-[108px] flex-[0_0_108px] place-items-center font-mono text-figure"
        style={{ background: cover.bg, color: cover.fg }}
        aria-hidden="true"
      >
        {event.name.trim()[0]?.toUpperCase() ?? "?"}
      </div>

      <div className="min-w-0 flex-[1_1_320px] p-[clamp(16px,2.4vw,22px)]">
        <div className="flex flex-wrap items-baseline gap-2.5">
          <h2 className="m-0 text-title font-semibold tracking-head">
            <Link href={`/events/${event.slug}`} className="underline-offset-4 hover:underline">
              {event.name}
            </Link>
          </h2>
          <StatusChip hue={status}>
            {STATUS_LABEL[event.status] ?? event.status}
          </StatusChip>
          {roles && roles.length > 0 ? (
            <RoleChips roles={roles} />
          ) : event.owner ? (
            <span className="ml-auto font-mono text-meta text-muted">
              {event.owner.org ?? event.owner.name}
            </span>
          ) : null}
        </div>

        {event.tagline ? (
          <p className="mt-[9px] max-w-[62ch] text-ui leading-[1.6] text-muted [text-wrap:pretty]">
            {event.tagline}
          </p>
        ) : null}

        <div className="meta-row">
          <span>{dateRange(event)}</span>
          <span>
            {MODE_LABEL[event.mode ?? "HYBRID"]}
            {event.place ? ` · ${event.place}` : ""}
          </span>
          {pool ? <span>{pool}</span> : null}
          {event.minTeamSize && event.maxTeamSize ? (
            <span>
              Teams of {event.minTeamSize}-{event.maxTeamSize}
            </span>
          ) : null}
          {event._count ? <span>{event._count.memberships} registered</span> : null}
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-3.5">
          {(event.themeTags ?? []).slice(0, 3).map((tag) => (
            <span
              key={tag}
              className="rounded-full border border-line bg-elevated px-2.5 py-1 font-mono text-meta text-muted"
            >
              {tag}
            </span>
          ))}
          <span className="text-small text-muted">{closesIn(event)}</span>

          <span className="ml-auto flex flex-wrap items-center gap-2">
            {actions}
            <Link href={`/events/${event.slug}?tab=Gallery`} className="btn btn-sm" aria-label={`Gallery, ${event.name}`}>
              Gallery
            </Link>
            {event.resultsPublished ? (
              <Link href={`/events/${event.slug}/winners`} className="btn btn-sm" aria-label={`Winners, ${event.name}`}>
                Winners
              </Link>
            ) : null}
            <Link href={`/events/${event.slug}`} className="btn-primary btn-sm" aria-label={`View event, ${event.name}`}>
              View event
            </Link>
          </span>
        </div>
      </div>
    </article>
  );
}
