import { notFound } from "next/navigation";
import { get } from "@/lib/api";
import { coverHue, hue } from "@/lib/hues";
import type { EventDetail, Paginated, SubmissionCard } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * The event's public gallery with no site chrome, for dropping into a sponsor
 * page with an iframe. It reads only what the public gallery already shows.
 */
export default async function EmbedGallery({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  let event: EventDetail;
  let gallery: Paginated<SubmissionCard>;
  try {
    [event, gallery] = await Promise.all([
      get<EventDetail>(`/events/${slug}`),
      get<Paginated<SubmissionCard>>(`/events/${slug}/submissions?take=48`),
    ]);
  } catch {
    notFound();
  }

  return (
    <main className="p-4">
      <div className="flex items-baseline justify-between gap-3">
        <div className="eyebrow">{event.name} · gallery</div>
        <a href={`/events/${slug}`} target="_blank" rel="noopener" className="inline-flex min-h-[44px] items-center font-mono text-label text-muted hover:text-text">
          podium
        </a>
      </div>
      {gallery.items.length === 0 ? (
        <p className="mt-6 text-ui text-muted">No projects published yet.</p>
      ) : (
        <div className="mt-4 grid gap-x-5 gap-y-6 [grid-template-columns:repeat(auto-fill,minmax(min(220px,100%),1fr))]">
          {gallery.items.map((project, i) => {
            const h = hue(coverHue(project.track?.name ?? project.name));
            return (
              <a
                key={project.id}
                href={`/events/${slug}?tab=Gallery`}
                target="_blank"
                rel="noopener"
                className="group min-w-0"
                style={{ animation: `pop 460ms cubic-bezier(0.16,1,0.3,1) ${i * 30}ms both` }}
              >
                <div
                  className="grid aspect-[4/3] w-full place-items-center overflow-hidden rounded-[10px] border border-line bg-cover bg-center font-mono text-heading transition-transform duration-500 group-hover:-translate-y-0.5"
                  style={{
                    background: project.thumbnailUrl ? `center / cover url(${project.thumbnailUrl})` : h.bg,
                    color: h.fg,
                  }}
                >
                  {project.thumbnailUrl ? null : project.name.charAt(0).toUpperCase()}
                </div>
                <div className="mt-2.5 truncate text-ui font-medium tracking-head">{project.name}</div>
                <div className="mt-0.5 truncate text-small text-muted">{project.tagline ?? project.team.name}</div>
              </a>
            );
          })}
        </div>
      )}
    </main>
  );
}
