"use client";

import { useEffect, useState } from "react";

/**
 * An image referenced by URL. The platform hosts no uploads, so a link can
 * simply be wrong: this says so instead of leaving a blank tile.
 */
export function PreviewImage({ url, alt, className = "" }: { url: string; alt: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [url]);

  if (failed) {
    return (
      <div
        role="img"
        aria-label={alt}
        className={`bg-dots grid place-content-center justify-items-center gap-2 border border-dashed border-line-strong/50 bg-elevated px-3 text-center text-small text-muted ${className}`.trim()}
      >
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="var(--k-orange)" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
          <path d="M3.5 15.5l4.5-4.5 4 4 2.5-2.5 6 6" />
          <path d="M9.5 8.5h.01" />
        </svg>
        <span>This link did not load as an image.</span>
      </div>
    );
  }
  return (
    // links to hosts we cannot know in advance
    <img src={url} alt={alt} loading="lazy" onError={() => setFailed(true)} className={`object-cover ${className}`.trim()} />
  );
}
