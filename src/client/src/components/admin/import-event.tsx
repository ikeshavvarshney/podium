"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { ApiError, post } from "@/lib/api";

/** Brings in an event exported from any podium instance (Exports, event.json). */
export function ImportEvent() {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function importFile(file: File) {
    setBusy(true);
    setError("");
    try {
      const data = JSON.parse(await file.text());
      const slug = window.prompt("Link for the imported event", `${data?.event?.slug ?? "imported"}-copy`);
      if (!slug) return;
      const res = await post<{ slug: string }>("/events/import", { data, slug });
      router.push(`/events/${res.slug}/manage`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "That file is not a podium event export.");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <input
        ref={input}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void importFile(file);
        }}
      />
      <button type="button" onClick={() => input.current?.click()} disabled={busy} className="btn disabled:opacity-60">
        {busy ? "Importing..." : "Import event"}
      </button>
      {error ? <span className="text-small text-danger">{error}</span> : null}
    </div>
  );
}
