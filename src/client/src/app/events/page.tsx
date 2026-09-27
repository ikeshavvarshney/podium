import Link from "next/link";
import { EventCard } from "@/components/event/event-card";
import { OrbitMark } from "@/components/event/rubric-diagram";
import { SortSelect } from "@/components/event/sort-select";
import { get } from "@/lib/api";
import { STATUS_LABEL } from "@/lib/hues";
import type { EventSummary, Paginated } from "@/lib/types";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterGroup, FilterPill } from "@/components/ui/filter-pill";
import { FilterPanel } from "@/components/ui/filter-panel";

export const dynamic = "force-dynamic";

const STATUS_FILTERS = [
  "REGISTRATION_OPEN",
  "SUBMISSIONS_OPEN",
  "JUDGING",
  "VOTING",
  "RESULTS_PUBLISHED",
];

const SORTS = [
  { value: "recent", label: "Newest" },
  { value: "deadline", label: "Closing soon" },
  { value: "name", label: "Name" },
];

type Search = { q?: string; status?: string; theme?: string; sort?: string; mode?: string; eligibility?: string };

const MODE_FILTERS = [
  { value: "ONLINE", label: "Online" },
  { value: "IN_PERSON", label: "In-person" },
  { value: "HYBRID", label: "Hybrid" },
];

function buildQuery(search: Search, override: Partial<Search>): string {
  const merged = { ...search, ...override };
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(merged)) {
    if (value) params.set(key, value);
  }
  const qs = params.toString();
  return qs ? `/events?${qs}` : "/events";
}

export default async function DiscoverPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const search = await searchParams;

  const apiParams = new URLSearchParams();
  if (search.q) apiParams.set("q", search.q);
  if (search.status) apiParams.set("status", search.status);
  if (search.theme) apiParams.set("theme", search.theme);
  if (search.mode) apiParams.set("mode", search.mode);
  if (search.eligibility) apiParams.set("eligibility", search.eligibility);
  if (search.sort) apiParams.set("sort", search.sort);

  let data: Paginated<EventSummary> = { items: [], total: 0, take: 0, skip: 0 };
  let failed = false;
  try {
    data = await get<Paginated<EventSummary>>(`/events?${apiParams.toString()}`);
  } catch {
    failed = true;
  }

  const themes = [...new Set(data.items.flatMap((e) => e.themeTags))].slice(0, 10);
  const eligibilities = [...new Set(data.items.map((e) => e.eligibility).filter(Boolean))].slice(0, 6) as string[];
  const activeCount = [search.q, search.status, search.theme, search.mode, search.eligibility].filter(Boolean).length;
  const filtersActive = Boolean(
    search.q || search.status || search.theme || search.sort || search.mode || search.eligibility,
  );

  return (
    <main className="screen max-w-[1400px]">
      <div className="flex flex-wrap items-end justify-between gap-6 border-b border-line pb-[clamp(20px,3vw,28px)]">
        <div className="min-w-0 flex-[1_1_300px]">
          <div className="eyebrow">Discover</div>
          <h1 className="display mt-[14px] max-w-[20ch] text-hero">
            Events open for registration
          </h1>
          <p className="mt-4 max-w-[58ch] text-body leading-[1.6] text-muted [text-wrap:pretty]">
            Every event publishes its rubric and judging window before registration closes.{" "}
            {data.total} event{data.total === 1 ? "" : "s"} listed.
          </p>
        </div>

        <OrbitMark
          hues={["var(--h1)", "var(--h2)", "var(--h3)", "var(--h4)", "var(--h5)", "var(--h6)"]}
          label="Events pulsing open across regions"
        />

        <SortSelect options={SORTS} />
      </div>

      <div className="mt-[clamp(24px,4vw,34px)] flex flex-wrap items-start gap-[clamp(24px,4vw,48px)]">
        <aside className="grid w-full gap-4 md:max-w-[260px] md:min-w-[190px] md:flex-[1_1_200px] md:gap-[26px]">
          <form action="/events" className="flex gap-2">
            {search.sort && <input type="hidden" name="sort" value={search.sort} />}
            <input
              name="q"
              defaultValue={search.q ?? ""}
              placeholder="Search events, hosts, themes"
              aria-label="Search events"
              className="field min-w-0 flex-1"
            />
            <button type="submit" className="btn flex-none md:sr-only">
              Search
            </button>
          </form>

          <FilterPanel activeCount={activeCount}>
            <FilterGroup label="Mode" allHref={buildQuery(search, { mode: undefined })} anySelected={Boolean(search.mode)}>
              {MODE_FILTERS.map((mode) => (
                <FilterPill
                  key={mode.value}
                  href={buildQuery(search, { mode: search.mode === mode.value ? undefined : mode.value })}
                  active={search.mode === mode.value}
                >
                  {mode.label}
                </FilterPill>
              ))}
            </FilterGroup>

            <FilterGroup label="Status" allHref={buildQuery(search, { status: undefined })} anySelected={Boolean(search.status)}>
              {STATUS_FILTERS.map((status) => (
                <FilterPill
                  key={status}
                  href={buildQuery(search, { status: search.status === status ? undefined : status })}
                  active={search.status === status}
                >
                  {STATUS_LABEL[status]}
                </FilterPill>
              ))}
            </FilterGroup>

            {themes.length > 0 && (
              <FilterGroup label="Theme" allHref={buildQuery(search, { theme: undefined })} anySelected={Boolean(search.theme)}>
                {themes.map((theme) => (
                  <FilterPill
                    key={theme}
                    href={buildQuery(search, { theme: search.theme === theme ? undefined : theme })}
                    active={search.theme === theme}
                  >
                    {theme}
                  </FilterPill>
                ))}
              </FilterGroup>
            )}

            {eligibilities.length > 0 && (
              <FilterGroup
                label="Eligibility"
                allHref={buildQuery(search, { eligibility: undefined })}
                anySelected={Boolean(search.eligibility)}
              >
                {eligibilities.map((value) => (
                  <FilterPill
                    key={value}
                    href={buildQuery(search, { eligibility: search.eligibility === value ? undefined : value })}
                    active={search.eligibility === value}
                  >
                    {value}
                  </FilterPill>
                ))}
              </FilterGroup>
            )}

            {filtersActive && (
              <Link href="/events" className="btn btn-sm justify-self-start text-muted">
                Clear filters
              </Link>
            )}
          </FilterPanel>
        </aside>

        <div className="grid min-w-0 flex-[999_1_420px] gap-4">
          {failed ? (
            <EmptyState tone="danger">
              Could not reach the API. Check that the server is running.
            </EmptyState>
          ) : data.items.length === 0 ? (
            <EmptyState
              action={
                filtersActive ? (
                  <Link href="/events" className="btn">
                    Clear filters
                  </Link>
                ) : undefined
              }
            >
              Nothing matches those filters. Clear one and try again.
            </EmptyState>
          ) : (
            data.items.map((event) => <EventCard key={event.id} event={event} />)
          )}
        </div>
      </div>
    </main>
  );
}
