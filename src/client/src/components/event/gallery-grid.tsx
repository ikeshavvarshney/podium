"use client";

import Link from "next/link";
import { useState } from "react";
import { coverHue, hue } from "@/lib/hues";
import { GalleryModal } from "./gallery-modal";
import type { SubmissionCard } from "@/lib/types";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusChip } from "@/components/ui/status-chip";
import { mediaUrl } from "@/lib/api";

export function GalleryGrid({
  slug,
  items,
  isEventAdmin,
  clearHref,
}: {
  slug: string;
  items: SubmissionCard[];
  isEventAdmin: boolean;
  /** Set when a search or filter is active, so an empty result offers a way back. */
  clearHref?: string;
}) {
  const [openId, setOpenId] = useState<string | null>(null);

  if (items.length === 0) {
    return clearHref ? (
      <EmptyState
        action={
          <Link href={clearHref} className="btn">
            Clear search and filters
          </Link>
        }
      >
        No projects match these filters.
      </EmptyState>
    ) : (
      <EmptyState>
        No submissions published yet. Projects appear here once teams submit.
      </EmptyState>
    );
  }

  return (
    <>
      <div className="grid gap-x-6 gap-y-[26px] [grid-template-columns:repeat(auto-fill,minmax(min(260px,100%),1fr))]">
        {items.map((project) => {
          const tone = hue(coverHue(project.track?.name ?? project.name));
          const initial = project.name.trim()[0]?.toUpperCase() ?? "?";
          return (
            <article key={project.id} className="min-w-0">
              <button
                type="button"
                onClick={() => setOpenId(project.id)}
                className="group block w-full cursor-pointer border-0 bg-transparent p-0 text-left"
              >
                <div
                  className="relative w-full overflow-hidden rounded-[10px] border border-line bg-elevated bg-cover bg-center transition-shadow duration-200 group-hover:shadow-[var(--home-shadow)]"
                  style={{
                    aspectRatio: "4 / 3",
                    backgroundImage: project.thumbnailUrl ? `url(${mediaUrl(project.thumbnailUrl)})` : undefined,
                  }}
                >
                  {project.thumbnailUrl ? null : (
                    <div
                      className="absolute inset-0 grid place-items-center"
                      style={{ background: tone.bg, color: tone.fg }}
                      aria-hidden="true"
                    >
                      <span className="display text-hero leading-none tracking-display">{initial}</span>
                      <span className="absolute bottom-2 left-2.5 font-mono text-label uppercase tracking-stamp opacity-80">
                        no preview
                      </span>
                    </div>
                  )}
                </div>
                <div className="mt-3 min-w-0">
                  {project.track && (
                    <StatusChip hue={tone} className="mb-1.5 inline-block max-w-full truncate align-top">
                      {project.track.name}
                    </StatusChip>
                  )}
                  <h3 className="m-0 line-clamp-2 text-body font-semibold tracking-head transition-colors group-hover:text-accent-text">
                    {project.name}
                  </h3>
                </div>
                {project.tagline && (
                  <p className="mt-1.5 line-clamp-2 text-ui leading-[1.55] text-muted [text-wrap:pretty]">
                    {project.tagline}
                  </p>
                )}
                <p className="mt-2 truncate text-small text-muted">{project.team.name}</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {project.techTags.slice(0, 4).map((tag) => (
                    <span
                      key={tag}
                      className="rounded-full border border-line px-2 py-0.5 font-mono text-label text-muted"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </button>
            </article>
          );
        })}
      </div>

      {openId && (
        <GalleryModal
          slug={slug}
          submissionId={openId}
          isEventAdmin={isEventAdmin}
          onClose={() => setOpenId(null)}
        />
      )}
    </>
  );
}
