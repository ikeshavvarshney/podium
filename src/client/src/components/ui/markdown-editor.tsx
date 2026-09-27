"use client";

import { useState } from "react";
import { Markdown } from "./markdown";
import { Segmented } from "./segmented";

/**
 * A raw Markdown textarea with a rendered preview, one at a time. The preview uses the same
 * renderer as the event page, so what the organizer sees is what participants get.
 */
export function MarkdownEditor({
  id,
  label,
  value,
  onChange,
  onBlur,
  placeholder,
  disabled = false,
  className = "",
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** Called when the textarea loses focus or the organizer switches to the preview. */
  onBlur?: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}) {
  const [view, setView] = useState<"write" | "preview">("write");

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label htmlFor={id} className="text-ui font-medium">
          {label}
        </label>
        <Segmented
          label={`${label}: write or preview`}
          className="w-[190px]"
          value={view}
          onChange={(next) => {
            if (next === "preview") onBlur?.(value);
            setView(next);
          }}
          options={[
            { id: "write", label: "Write" },
            { id: "preview", label: "Preview" },
          ]}
        />
      </div>
      {view === "write" ? (
        <textarea
          id={id}
          className={`${className} min-h-[180px] resize-y font-mono text-small leading-[1.65]`}
          value={value}
          disabled={disabled}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          onBlur={(e) => onBlur?.(e.target.value)}
          aria-describedby={`${id}-help`}
        />
      ) : (
        <div className="min-h-[180px] rounded-[10px] border border-line bg-surface p-4" aria-live="polite">
          {value.trim() ? (
            <Markdown source={value} />
          ) : (
            <p className="m-0 text-ui text-muted">Nothing to preview yet.</p>
          )}
        </div>
      )}
      <p id={`${id}-help`} className="m-0 text-small leading-[1.5] text-muted">
        Markdown: <code className="font-mono">## Heading</code>, <code className="font-mono">**bold**</code>,{" "}
        <code className="font-mono">- list</code>, <code className="font-mono">[link](https://...)</code>, tables and code
        blocks. HTML is not rendered.
      </p>
    </div>
  );
}
