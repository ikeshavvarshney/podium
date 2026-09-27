import Link from "next/link";
import { FilterGroup, FilterPill } from "@/components/ui/filter-pill";
import { FilterPanel } from "@/components/ui/filter-panel";

export interface GalleryFacets {
  total: number;
  tags: Array<{ tag: string; count: number }>;
  tracks: Array<{ id: string; name: string; slug: string; count: number }>;
}

export interface GallerySearch {
  gq?: string;
  gtrack?: string;
  gtag?: string;
  gsort?: string;
}

const SORTS = [
  { value: "recent", label: "Newest" },
  { value: "name", label: "Name" },
  { value: "random", label: "Shuffle" },
];

/** The gallery URL for a set of filters. Always keeps the Gallery tab open. */
export function galleryHref(slug: string, search: GallerySearch, override: Partial<GallerySearch> = {}): string {
  const merged = { ...search, ...override };
  const params = new URLSearchParams({ tab: "Gallery" });
  for (const [key, value] of Object.entries(merged)) {
    if (value) params.set(key, value);
  }
  return `/events/${slug}?${params.toString()}`;
}

/**
 * Search, filter and sort for the public gallery. Everything is a URL
 * parameter, so a filtered gallery can be shared and works without
 * JavaScript. The count is announced as it changes.
 */
export function GalleryToolbar({
  slug,
  search,
  facets,
  shown,
}: {
  slug: string;
  search: GallerySearch;
  facets: GalleryFacets;
  shown: number;
}) {
  const active = [search.gq, search.gtrack, search.gtag].filter(Boolean).length;
  const filtered = active > 0 || Boolean(search.gsort);

  return (
    <div className="mb-[clamp(20px,3vw,28px)] grid gap-4">
      <form action={`/events/${slug}`} className="flex gap-2">
        <input type="hidden" name="tab" value="Gallery" />
        {search.gtrack ? <input type="hidden" name="gtrack" value={search.gtrack} /> : null}
        {search.gtag ? <input type="hidden" name="gtag" value={search.gtag} /> : null}
        {search.gsort ? <input type="hidden" name="gsort" value={search.gsort} /> : null}
        <input
          name="gq"
          defaultValue={search.gq ?? ""}
          placeholder="Search projects, teams, tags"
          aria-label="Search projects"
          className="field min-w-0 flex-1 md:max-w-[420px]"
        />
        <button type="submit" className="btn flex-none">
          Search
        </button>
      </form>

      {facets.tracks.length > 0 || facets.tags.length > 0 ? (
        <FilterPanel activeCount={[search.gtrack, search.gtag].filter(Boolean).length} label="Filter projects">
          {facets.tracks.length > 0 ? (
            <FilterGroup label="Track" allHref={galleryHref(slug, search, { gtrack: undefined })} anySelected={Boolean(search.gtrack)}>
              {facets.tracks.map((t) => (
                <FilterPill
                  key={t.id}
                  href={galleryHref(slug, search, { gtrack: search.gtrack === t.slug ? undefined : t.slug })}
                  active={search.gtrack === t.slug}
                  count={t.count}
                >
                  {t.name}
                </FilterPill>
              ))}
            </FilterGroup>
          ) : null}
          {facets.tags.length > 0 ? (
            <FilterGroup label="Tech" allHref={galleryHref(slug, search, { gtag: undefined })} anySelected={Boolean(search.gtag)}>
              {facets.tags.slice(0, 10).map((t) => (
                <FilterPill
                  key={t.tag}
                  href={galleryHref(slug, search, { gtag: search.gtag === t.tag ? undefined : t.tag })}
                  active={search.gtag === t.tag}
                  count={t.count}
                >
                  {t.tag}
                </FilterPill>
              ))}
            </FilterGroup>
          ) : null}
        </FilterPanel>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-b border-line pb-3">
        <p role="status" aria-live="polite" className="m-0 text-ui text-muted">
          {active > 0 ? `${shown} of ${facets.total} projects` : `${facets.total} project${facets.total === 1 ? "" : "s"}`}
        </p>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="eyebrow">Sort</span>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Sort projects">
            {SORTS.map((s) => (
              <FilterPill
                key={s.value}
                href={galleryHref(slug, search, { gsort: s.value === "recent" ? undefined : s.value })}
                active={(search.gsort ?? "recent") === s.value}
              >
                {s.label}
              </FilterPill>
            ))}
          </div>
          {filtered ? (
            <Link href={galleryHref(slug, {})} className="btn btn-sm text-muted">
              Clear
            </Link>
          ) : null}
        </div>
      </div>
    </div>
  );
}
