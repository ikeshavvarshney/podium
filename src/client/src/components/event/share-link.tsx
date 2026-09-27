"use client";

import { useEffect, useState } from "react";

/** The public address of an event with a one-click copy. The link works for anyone the event's visibility allows. */
export function ShareLink({ slug, note }: { slug: string; note?: string }) {
  const [url, setUrl] = useState(`/events/${slug}`);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setUrl(`${window.location.origin}/events/${slug}`);
  }, [slug]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      const el = document.createElement("textarea");
      el.value = url;
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      el.remove();
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  return (
    <div>
      <div className="flex flex-wrap items-stretch gap-2">
        <input
          readOnly
          aria-label="Event link"
          value={url}
          onFocus={(e) => e.currentTarget.select()}
          className="field min-w-0 flex-1 font-mono text-small"
        />
        <button type="button" onClick={() => void copy()} className="btn">
          {copied ? "Copied" : "Copy link"}
        </button>
      </div>
      <div role="status" className="mt-1.5 text-small leading-[1.5] text-muted">
        {note ?? ""}
      </div>
    </div>
  );
}
