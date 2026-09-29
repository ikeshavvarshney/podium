import Link from "next/link";
import { notFound } from "next/navigation";
import { Countdown } from "@/components/event/countdown";
import { ParticipantPanel } from "@/components/event/participant-panel";
import { GalleryGrid } from "@/components/event/gallery-grid";
import { GalleryToolbar, galleryHref, type GalleryFacets, type GallerySearch } from "@/components/event/gallery-toolbar";
import { serverGet } from "@/lib/server-api";
import { coverHue, hue, STATUS_HUE, STATUS_LABEL } from "@/lib/hues";
import type {
  Challenge,
  EventDetail,
  EventPerson,
  Paginated,
  Partner,
  SubmissionCard,
} from "@/lib/types";
import { StatusChip } from "@/components/ui/status-chip";
import { EmptyState } from "@/components/ui/empty-state";
import { Markdown } from "@/components/ui/markdown";
import { usd, utcDateTime } from "@/lib/format";
import { mediaUrl } from "@/lib/api";
import { can } from "@/lib/permissions";
import { eventNav } from "@/lib/event-nav";

export const dynamic = "force-dynamic";

const TABS = ["About", "Gallery", "Rounds", "Challenges", "Prizes", "Rules", "People", "FAQ"] as const;
type Tab = (typeof TABS)[number];

function formatDate(value: string | null): string {
  if (!value) return "not scheduled";
  return utcDateTime(value);
}

function formatMoney(cents: number | null): string | null {
  return cents === null ? null : usd(cents);
}

interface Round {
  id: string;
  name: string;
  description: string | null;
  opensAt: string | null;
  closesAt: string | null;
  advances: number | null;
}

interface FaqItem {
  id: string;
  question: string;
  answer: string;
}

const MODE_LABEL: Record<string, string> = {
  ONLINE: "Online · Remote",
  IN_PERSON: "In-person",
  HYBRID: "Hybrid",
};

/** The next milestone still ahead, which is what the countdown tracks. */
function nextMilestone(event: EventDetail): { at: string; label: string } | null {
  const now = Date.now();
  const candidates: Array<{ at: string | null; label: string }> = [
    // Someone already registered is counting toward the submission deadline, not registration.
    ...(event.viewer.isParticipant ? [] : [{ at: event.registrationClosesAt, label: "Time left to register" }]),
    { at: event.submissionDeadline, label: "Time left to submit" },
    { at: event.judgingClosesAt, label: "Time left in judging" },
    { at: event.votingClosesAt, label: "Time left to vote" },
  ];
  const upcoming = candidates
    .filter((c): c is { at: string; label: string } => Boolean(c.at && new Date(c.at).getTime() > now))
    .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
  return upcoming[0] ?? null;
}

export default async function EventPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ tab?: string } & GallerySearch>;
}) {
  const { slug } = await params;
  const { tab: rawTab, ...gallerySearch } = await searchParams;
  const tab: Tab = (TABS as readonly string[]).includes(rawTab ?? "")
    ? (rawTab as Tab)
    : "About";

  let event: EventDetail;
  try {
    event = await serverGet<EventDetail>(`/events/${slug}`);
  } catch {
    notFound();
  }

  let gallery: Paginated<SubmissionCard> = { items: [], total: 0, take: 0, skip: 0 };
  try {
    const query = new URLSearchParams();
    if (gallerySearch.gq) query.set("q", gallerySearch.gq);
    if (gallerySearch.gtrack) query.set("track", gallerySearch.gtrack);
    if (gallerySearch.gtag) query.set("tag", gallerySearch.gtag);
    if (gallerySearch.gsort) query.set("sort", gallerySearch.gsort);
    const qs = query.toString();
    gallery = await serverGet<Paginated<SubmissionCard>>(`/events/${slug}/submissions${qs ? `?${qs}` : ""}`);
  } catch {
    // Gallery is optional context.
  }

  const galleryFacets = await serverGet<GalleryFacets>(`/events/${slug}/submissions/facets`).catch(
    () => ({ total: gallery.total, tags: [], tracks: [] }) as GalleryFacets,
  );
  const galleryFiltered = Boolean(gallerySearch.gq || gallerySearch.gtrack || gallerySearch.gtag);

  const [rounds, faq, people, partners, challenges] = await Promise.all([
    serverGet<Round[]>(`/events/${slug}/rounds`).catch(() => [] as Round[]),
    serverGet<FaqItem[]>(`/events/${slug}/faq`).catch(() => [] as FaqItem[]),
    serverGet<EventPerson[]>(`/events/${slug}/people`).catch(() => [] as EventPerson[]),
    serverGet<Partner[]>(`/events/${slug}/partners`).catch(() => [] as Partner[]),
    serverGet<Challenge[]>(`/events/${slug}/challenges`).catch(() => [] as Challenge[]),
  ]);

  const cover = hue(coverHue(event.name));
  const status = hue(STATUS_HUE[event.status] ?? "slate");
  const { viewer } = event;

  const poolCents = event.prizes.reduce((sum, p) => sum + (p.amountCents ?? 0), 0);
  const stats = [
    { label: "Registered", value: String(event._count?.memberships ?? 0), hue: "brand" },
    {
      label: "Submissions",
      value: event._count?.submissions ? String(event._count.submissions) : "-",
      hue: "brand",
    },
    {
      label: "Prize pool",
      value: formatMoney(poolCents || null) ?? "-",
      hue: "brand",
    },
    { label: "Team size", value: `${event.minTeamSize}-${event.maxTeamSize}`, hue: "brand" },
  ];
  const milestone = nextMilestone(event);

  const registerLabel = "Register for this event";
  const registerNote = `Eligibility: ${event.eligibility}. Teams of ${event.minTeamSize} to ${event.maxTeamSize}.`;

  return (
    <main className="screen max-w-[1180px] pt-[clamp(26px,4vw,40px)]">
      <Link
        href="/events"
        className="inline-flex items-center gap-[7px] font-mono text-label uppercase tracking-label text-muted transition-colors hover:text-text"
      >
        <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M14 6l-6 6 6 6" />
        </svg>
        All events
      </Link>

      {event.bannerUrl ? (
        <img
          src={mediaUrl(event.bannerUrl)}
          alt=""
          className="mt-5 block aspect-[3/1] w-full rounded-[14px] border border-line object-cover"
        />
      ) : null}

      <div className="mt-5 flex flex-wrap items-end gap-[clamp(20px,3vw,30px)] border-b border-line pb-[clamp(22px,3vw,30px)]">
        <div
          className="grid h-[92px] w-[92px] flex-none place-items-center overflow-hidden rounded-[14px] font-mono text-[34px]"
          style={{ background: cover.bg, color: cover.fg }}
          aria-hidden="true"
        >
          {event.logoUrl ? (
            <img src={mediaUrl(event.logoUrl)} alt="" className="h-full w-full object-cover" />
          ) : (
            event.name.trim()[0]?.toUpperCase() ?? "?"
          )}
        </div>

        <div className="min-w-0 flex-[1_1_320px]">
          <div className="flex flex-wrap items-center gap-2.5">
            <StatusChip hue={status}>
              {STATUS_LABEL[event.status] ?? event.status}
            </StatusChip>
            <span className="eyebrow">{event.owner.org ?? event.owner.name}</span>
            {viewer.roles.map((role) => {
              const rh = hue(role === "JUDGE" ? "amber" : role === "ADMIN" ? "plum" : "blue");
              return (
                <span
                  key={role}
                  className="chip uppercase tracking-stamp"
                  style={{ background: rh.bg, color: rh.fg }}
                  title="Your role in this event only"
                >
                  your role: {role.toLowerCase()}
                </span>
              );
            })}
          </div>

          <h1 className="display mt-[14px] max-w-[24ch] text-hero">
            {event.name}
          </h1>

          {event.tagline && (
            <p className="mt-[14px] max-w-[58ch] text-body leading-[1.6] text-muted [text-wrap:pretty]">
              {event.tagline}
            </p>
          )}

          <div className="mt-[14px] flex flex-wrap items-center gap-x-[18px] gap-y-2.5 font-mono text-meta leading-[1.5]">
            <span className="whitespace-nowrap">
              {formatDate(event.submissionsOpenAt)} to {formatDate(event.submissionDeadline)}
            </span>
            <span className="whitespace-nowrap">
              {MODE_LABEL[event.mode ?? "HYBRID"]}
              {event.place ? ` · ${event.place}` : ""}
            </span>
            <span className="whitespace-nowrap">
              Registration {event.registrationClosesAt && new Date(event.registrationClosesAt).getTime() < Date.now() ? "closed" : "closes"}{" "}
              {formatDate(event.registrationClosesAt)}
            </span>
          </div>

          {milestone ? <Countdown deadline={milestone.at} label={milestone.label} /> : null}
        </div>

        <div className="flex max-w-[300px] flex-[1_1_240px] flex-col items-stretch gap-2.5">
          {event.resultsPublished && (
            <Link
              href={`/events/${event.slug}/winners`}
              className="btn px-[18px] py-[11px] text-ui"
            >
              See the winners
            </Link>
          )}
          {viewer.isEventAdmin ? (
            <>
              <Link
                href={eventNav(event).find((i) => i.key !== "overview")?.href ?? `/events/${event.slug}`}
                className="btn-primary px-[18px] py-[11px] text-ui"
              >
                Manage this event
              </Link>
              <span className="text-small leading-[1.5] text-muted">
                Rubric, judging panel, assignment and results.
              </span>
            </>
          ) : viewer.isJudge ? (
            <>
              <Link
                href={`/events/${event.slug}/judge`}
                className="btn-primary px-[18px] py-[11px] text-ui"
              >
                Open scoring queue
              </Link>
              <span className="text-small leading-[1.5] text-muted">
                You see only the projects assigned to you.
              </span>
            </>
          ) : viewer.isParticipant ? (
            <ParticipantPanel event={event} />
          ) : (
            <>
              <Link
                href={`/events/${event.slug}/register`}
                className="btn-primary px-[18px] py-[11px] text-ui"
              >
                {registerLabel}
              </Link>
              <span className="text-small leading-[1.5] text-muted">{registerNote}</span>
            </>
          )}

          <div className="flex flex-wrap gap-[7px]">
            {event.themeTags.map((theme) => (
              <span
                key={theme}
                className="rounded-full border border-line bg-elevated px-3 py-1.5 font-mono text-meta text-muted"
              >
                {theme}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-[clamp(22px,3vw,30px)] grid gap-2.5 [grid-template-columns:repeat(auto-fit,minmax(min(150px,100%),1fr))]">
        {stats.map((stat) => (
          <div
            key={stat.label}
            className="rounded-[10px] border border-line bg-surface px-[18px] pb-4 pt-[15px]"
            style={{
              borderTop: `3px solid var(--tone-${stat.hue}-fg)`,
              boxShadow:
                "inset 0 1px 0 var(--hl), 0 1px 2px -1px rgba(24,24,27,0.08), 0 4px 10px -6px rgba(24,24,27,0.10)",
            }}
          >
            <div className="eyebrow">{stat.label}</div>
            <div
              className="mt-2 text-figure font-medium tracking-display tabular-nums"
              style={{ color: `var(--tone-${stat.hue}-fg)` }}
            >
              {stat.value}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-[clamp(26px,4vw,38px)] flex flex-wrap gap-x-[22px] gap-y-1 border-b border-line">
        {TABS.map((item) => {
          const active = tab === item;
          return (
            <Link
              key={item}
              href={`/events/${event.slug}?tab=${item}`}
              aria-current={active ? "page" : undefined}
              className={`border-b-2 px-0.5 py-2.5 text-ui transition-colors duration-200 max-md:py-3.5 [@media(pointer:coarse)]:py-3.5 ${
                active ? "border-accent text-text" : "border-transparent text-muted hover:text-text"
              }`}
            >
              {item}
            </Link>
          );
        })}
      </div>

      {tab === "About" && (
        <div className="mt-[clamp(24px,3.4vw,34px)] grid max-w-[68ch] gap-[18px]">
          {event.description?.trim() ? (
            <Markdown source={event.description} />
          ) : (
            <p className="m-0 text-prose leading-[1.7] text-muted">No description yet.</p>
          )}

          <div className="mt-2 grid gap-2">
            <div className="eyebrow">Timeline</div>
            {[
              ["Registration closes", event.registrationClosesAt],
              ["Submissions open", event.submissionsOpenAt],
              ["Submission deadline", event.submissionDeadline],
              ["Judging opens", event.judgingOpensAt],
              ["Judging closes", event.judgingClosesAt],
              ["Voting closes", event.votingClosesAt],
            ].map(([label, value]) => (
              <div key={label as string} className="flex justify-between gap-4 border-b border-line py-2 text-ui">
                <span className="text-muted">{label}</span>
                <span className="font-mono text-small">{formatDate(value as string | null)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === "Gallery" && (
        <div className="mt-[clamp(24px,3.4vw,34px)]">
          {event.status === "VOTING" && (
            <div className="mb-6 flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface px-4 py-3.5">
              <span className="text-ui">Community voting is running for this event.</span>
              <Link href={`/events/${event.slug}/vote`} className="btn btn-sm ml-auto">
                Open the ballot
              </Link>
            </div>
          )}
          {galleryFacets.total > 0 || galleryFiltered ? (
            <GalleryToolbar slug={event.slug} search={gallerySearch} facets={galleryFacets} shown={gallery.items.length} />
          ) : null}
          <GalleryGrid
            slug={event.slug}
            items={gallery.items}
            isEventAdmin={can(viewer, "SUBMISSIONS")}
            clearHref={galleryFiltered ? galleryHref(event.slug, {}) : undefined}
          />
        </div>
      )}

      {tab === "Challenges" && (
        <div className="mt-[clamp(24px,3.4vw,34px)] grid gap-3.5 [grid-template-columns:repeat(auto-fit,minmax(min(300px,100%),1fr))]">
          {challenges.length === 0 ? (
            <EmptyState className="[grid-column:1/-1]">
              No sponsor challenges for this event.
            </EmptyState>
          ) : (
            challenges.map((c) => {
              const sponsorHue = hue(coverHue(c.sponsor));
              return (
                <article key={c.id} className="card flex flex-col gap-2.5 p-[clamp(16px,2.2vw,20px)]">
                  <div className="flex flex-wrap items-baseline justify-between gap-3">
                    <span
                      className="rounded-md px-[9px] py-1 font-mono text-label uppercase tracking-stamp"
                      style={{ background: sponsorHue.bg, color: sponsorHue.fg }}
                    >
                      {c.sponsor}
                    </span>
                    {c.amountCents !== null && (
                      <span className="whitespace-nowrap font-mono text-ui">
                        {formatMoney(c.amountCents)}
                      </span>
                    )}
                  </div>
                  <h3 className="m-0 text-title font-semibold tracking-head">{c.name}</h3>
                  <p className="m-0 text-ui leading-[1.6] text-muted [text-wrap:pretty]">{c.brief}</p>
                  <div className="mt-auto flex flex-wrap gap-1.5 pt-1.5">
                    {c.tags.map((tag) => (
                      <span
                        key={tag}
                        className="rounded-full border border-line bg-elevated px-2.5 py-1 font-mono text-label text-muted"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                  <div className="font-mono text-label text-muted">
                    {c.entries} {c.entries === 1 ? "entry" : "entries"}
                  </div>
                </article>
              );
            })
          )}
        </div>
      )}

      {tab === "Prizes" && (
        <div className="mt-[clamp(24px,3.4vw,34px)] grid gap-4">
          {event.prizes.length === 0 ? (
            <EmptyState>
              Prizes have not been announced yet.
            </EmptyState>
          ) : (
            event.prizes.map((prize) => (
              <article key={prize.id} className="card flex flex-wrap items-baseline gap-4 p-5">
                <div className="min-w-0 flex-1">
                  <h3 className="m-0 text-title font-semibold tracking-head">{prize.title}</h3>
                  {prize.description && (
                    <p className="mt-2 text-ui leading-[1.6] text-muted">{prize.description}</p>
                  )}
                  {prize.track && (
                    <p className="mt-2 font-mono text-meta text-muted">{prize.track.name} track</p>
                  )}
                </div>
                {prize.amountCents !== null && (
                  <span className="text-heading font-medium tracking-display">
                    {formatMoney(prize.amountCents)}
                  </span>
                )}
              </article>
            ))
          )}
        </div>
      )}

      {tab === "Rules" && (
        <div className="mt-[clamp(24px,3.4vw,34px)] grid max-w-[68ch] gap-[18px]">
          <p className="m-0 text-prose leading-[1.7] [text-wrap:pretty]">
            Judging is blind and normalized. Each submission is read by{" "}
            {event.reviewsPerSubmission} independent judges against a published rubric, and scores
            are adjusted for judge severity before any ranking is shown.
          </p>
          <p className="m-0 text-prose leading-[1.7] [text-wrap:pretty]">
            Teams are {event.minTeamSize} to {event.maxTeamSize} people. Eligibility is set by the
            organizer: {event.eligibility}. Identity is checked once at registration, not at
            submission.
          </p>
          <p className="m-0 text-prose leading-[1.7] [text-wrap:pretty]">
            The submission deadline is enforced by the server. Once it passes, edits are refused
            and the attempt is written to the event&apos;s audit log.
          </p>
          <p className="m-0 text-prose leading-[1.7] [text-wrap:pretty]">
            Code stays yours. You grant the organizers a licence to show the project in the public
            gallery.
          </p>
        </div>
      )}

      {tab === "People" && (
        <div className="mt-[clamp(24px,3.4vw,34px)] grid gap-4">
          <article className="card p-5">
            <div className="eyebrow">Organizer</div>
            <h3 className="mt-2 text-title font-semibold tracking-head">
              {event.owner.name}
            </h3>
            {event.owner.org && (
              <p className="mt-1 text-ui text-muted">{event.owner.org}</p>
            )}
          </article>
          <article className="card p-5">
            <div className="eyebrow">Judging panel</div>
            <p className="mt-2 text-ui leading-[1.6] text-muted">
              The panel is assigned per event by the organizer. Judges see only the projects
              assigned to them, and never another judge&apos;s scores.
            </p>
          </article>

          {people.length > 0 && (
            <div>
              <div className="eyebrow">Speakers and mentors</div>
              <div className="mt-3.5 grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(260px,100%),1fr))]">
                {people.map((person) => {
                  const chip = hue(coverHue(person.name));
                  return (
                    <div key={person.id} className="card flex items-center gap-3.5 p-4">
                      <span
                        className="grid h-[38px] w-[38px] flex-none place-items-center rounded-full font-mono text-small"
                        style={{ background: chip.bg, color: chip.fg }}
                      >
                        {person.name
                          .split(" ")
                          .map((p) => p[0])
                          .slice(0, 2)
                          .join("")
                          .toUpperCase()}
                      </span>
                      <div className="min-w-0">
                        <div className="truncate text-ui font-medium tracking-head">
                          {person.name}
                        </div>
                        <div className="mt-0.5 text-small text-muted">
                          {person.kind === "SPEAKER" ? "Speaker" : "Mentor"} · {person.role}
                        </div>
                        {person.org && (
                          <div className="mt-0.5 font-mono text-label text-muted">{person.org}</div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {partners.length > 0 && (
            <div>
              <div className="eyebrow">Partners</div>
              <div className="mt-3 flex flex-col">
                {partners.map((partner) => (
                  <div
                    key={partner.id}
                    className="flex items-baseline justify-between gap-4 border-b border-line py-3.5"
                  >
                    <span className="text-body">{partner.name}</span>
                    <span className="whitespace-nowrap font-mono text-meta text-muted">
                      {partner.tier}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
      {tab === "Rounds" && (
        <div className="mt-[clamp(24px,3.4vw,34px)] grid gap-2.5">
          {rounds.length === 0 ? (
            <p className="text-ui text-muted">
              This event runs as a single judging round.
            </p>
          ) : (
            rounds.map((round, i) => {
              const closed = round.closesAt && new Date(round.closesAt).getTime() < Date.now();
              const open =
                !closed && (!round.opensAt || new Date(round.opensAt).getTime() <= Date.now());
              const st = hue(closed ? "plum" : open ? "teal" : "slate");
              return (
                <div
                  key={round.id}
                  className="flex flex-wrap items-start gap-x-[22px] gap-y-3 rounded-xl border bg-surface p-[clamp(15px,2.2vw,20px)]"
                  style={{ borderColor: open ? "var(--ac)" : "var(--ln)" }}
                >
                  <span className="mt-0.5 flex-none font-mono text-ui text-muted">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <div className="min-w-0 flex-[1_1_240px]">
                    <div className="flex flex-wrap items-baseline gap-[9px]">
                      <h3 className="text-title font-semibold tracking-head">{round.name}</h3>
                      <span className="font-mono text-meta text-muted">
                        {formatDate(round.opensAt)} to {formatDate(round.closesAt)}
                      </span>
                    </div>
                    <p className="mt-2 max-w-[62ch] text-ui leading-[1.6] text-muted">
                      {round.description}
                      {round.advances ? ` Top ${round.advances} advance.` : ""}
                    </p>
                  </div>
                  <span
                    className="ml-auto flex-none rounded-md px-[9px] py-1 font-mono text-label uppercase tracking-stamp"
                    style={{ background: st.bg, color: st.fg }}
                  >
                    {closed ? "closed" : open ? "live" : "upcoming"}
                  </span>
                </div>
              );
            })
          )}
          <Link href={`/events/${event.slug}/rounds`} className="btn btn-sm mt-2 justify-self-start">
            Open the rounds ladder
          </Link>
        </div>
      )}

      {tab === "FAQ" && (
        <div className="mt-[clamp(24px,3.4vw,34px)] max-w-[760px]">
          {faq.length === 0 ? (
            <p className="text-ui text-muted">The organizer has not published any answers yet.</p>
          ) : (
            faq.map((item) => (
              <details
                key={item.id}
                className="group border-b border-line py-4 [&_summary::-webkit-details-marker]:hidden"
              >
                <summary className="flex cursor-pointer list-none items-baseline justify-between gap-4 text-body font-medium tracking-head">
                  {item.question}
                  <span className="flex-none font-mono text-ui text-muted transition-transform duration-300 group-open:rotate-45">
                    +
                  </span>
                </summary>
                <p
                  className="mt-3 max-w-[68ch] text-ui leading-[1.7] text-muted"
                  style={{ animation: "pop 320ms cubic-bezier(0.16,1,0.3,1) both" }}
                >
                  {item.answer}
                </p>
              </details>
            ))
          )}
        </div>
      )}
    </main>
  );
}
