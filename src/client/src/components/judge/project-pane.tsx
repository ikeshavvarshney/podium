"use client";

import { useEffect, useState, type RefObject } from "react";
import { PreviewImage } from "@/components/submission/preview-image";
import { coverHue, hue } from "@/lib/hues";
import type { QueueItem } from "./types";

const LONG = 480;

function ExternalIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
    </svg>
  );
}

/**
 * The project under review. Identity and the three things a judge opens first
 * (demo, live site, repository) sit above the description, so nothing needs
 * scrolling to start. Long text is held to a few lines until asked for.
 */
export function ProjectPane({ item, headingRef }: { item: QueueItem; headingRef: RefObject<HTMLHeadingElement | null> }) {
  const { submission: s } = item;
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [s.id]);

  const description = s.description?.trim() ?? "";
  const long = description.length > LONG;
  const track = s.track ? hue(coverHue(s.track.name)) : null;

  const links = [
    { label: "Watch the demo", missing: "No demo recording", url: s.videoUrl, primary: true },
    { label: "Open the live site", missing: "No live site", url: s.liveUrl, primary: false },
    { label: "Read the code", missing: "No repository", url: s.repoUrl, primary: false },
  ];

  return (
    <article aria-labelledby="project-title" className="min-w-0">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1.5">
        <h1
          id="project-title"
          ref={headingRef}
          tabIndex={-1}
          className="m-0 min-w-0 font-display text-subject font-[560] leading-[1.12] tracking-[-0.03em] outline-none [overflow-wrap:anywhere]"
        >
          {s.name}
        </h1>
        {track && s.track ? (
          <span className="chip uppercase tracking-stamp" style={{ background: track.bg, color: track.fg }}>
            {s.track.name}
          </span>
        ) : null}
      </div>
      {s.tagline ? <p className="mt-2 max-w-[70ch] text-body leading-[1.5] text-muted [overflow-wrap:anywhere] [text-wrap:pretty]">{s.tagline}</p> : null}

      <div className="mt-4 grid items-start gap-3.5 sm:grid-cols-[minmax(0,240px)_minmax(0,1fr)]">
        {s.thumbnailUrl ? (
          <div className="overflow-hidden rounded-[10px] border border-line">
            <PreviewImage url={s.thumbnailUrl} alt={`Thumbnail for ${s.name}`} className="aspect-video w-full" />
          </div>
        ) : null}
        <ul className={`m-0 grid list-none gap-2 p-0 ${s.thumbnailUrl ? "" : "sm:col-span-2 sm:grid-cols-3"}`}>
          {links.map((link) => (
            <li key={link.label} className="m-0 min-w-0">
              {link.url ? (
                <a
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`${link.primary ? "btn-primary" : "btn"} min-h-[44px] w-full justify-between gap-3 text-left`}
                >
                  <span>
                    {link.label}
                    <span className="sr-only"> (opens in a new tab)</span>
                  </span>
                  <ExternalIcon />
                </a>
              ) : (
                <span className="flex min-h-[44px] items-center rounded-[10px] border border-dashed border-line px-[17px] text-ui text-muted">{link.missing}</span>
              )}
            </li>
          ))}
        </ul>
      </div>

      <section aria-labelledby="desc-title" className="mt-6">
        <h2 id="desc-title" className="eyebrow m-0">
          Description
        </h2>
        {description ? (
          <>
            <p className={`mt-2 max-w-[80ch] whitespace-pre-line text-ui leading-[1.65] [overflow-wrap:anywhere] [text-wrap:pretty] ${long && !open ? "line-clamp-6" : ""}`}>
              {description}
            </p>
            {long ? (
              <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)} className="mt-1.5 min-h-[44px] cursor-pointer text-small underline underline-offset-[3px] lg:min-h-0">
                {open ? "Show less" : "Read the full description"}
              </button>
            ) : null}
          </>
        ) : (
          <p className="mt-2 text-ui text-muted">No description provided.</p>
        )}
      </section>

      {s.answers.length > 0 ? (
        <section aria-labelledby="answers-title" className="mt-6">
          <h2 id="answers-title" className="eyebrow m-0">
            Answers to the organizer&apos;s questions
          </h2>
          <dl className="m-0 mt-2 grid gap-3">
            {s.answers.map((answer) => (
              <div key={answer.question.prompt}>
                <dt className="text-small font-medium [overflow-wrap:anywhere]">{answer.question.prompt}</dt>
                <dd className="m-0 mt-0.5 whitespace-pre-line text-ui leading-[1.6] text-muted [overflow-wrap:anywhere]">{answer.value}</dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null}

      {s.techTags.length > 0 ? (
        <ul className="m-0 mt-5 flex list-none flex-wrap gap-1.5 p-0" aria-label="Tech tags">
          {s.techTags.map((tag) => (
            <li key={tag} className="m-0 rounded-[4px] border border-line px-[7px] py-[3px] font-mono text-label text-muted">
              {tag}
            </li>
          ))}
        </ul>
      ) : null}
    </article>
  );
}
