"use client";

import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { PageHeader } from "@/components/ui/page-header";
import { PageStatus } from "@/components/ui/page-status";
import { apiBase, ApiError, get } from "@/lib/api";
import { utcDateTime } from "@/lib/format";

interface AuditEntry {
  id: string;
  action: string;
  summary: string;
  ipHash: string | null;
  createdAt: string;
  chainSeq: number | null;
  hash: string | null;
  metadata: Record<string, unknown>;
  actor: { id: string; name: string } | null;
}

interface ChainStatus {
  ok: boolean;
  entries: number;
  head: string | null;
  firstBreak: { id: string; chainSeq: number | null; reason: string } | null;
}

const GROUPS: Array<{ label: string; actions: string }> = [
  { label: "Everything", actions: "" },
  { label: "Judging", actions: "SCORE_SUBMITTED" },
  { label: "Changed ballots", actions: "SCORE_UPDATED" },
  { label: "Refused access", actions: "ACCESS_DENIED" },
  { label: "Roles", actions: "ROLE_GRANTED" },
  { label: "Results", actions: "RESULTS_PUBLISHED" },
  { label: "Late edits", actions: "SUBMISSION_EDIT_REJECTED" },
  { label: "Rejected votes", actions: "VOTE_REJECTED" },
];

const plain = (action: string) => action.toLowerCase().replace(/_/g, " ");

export default function AuditPage() {
  const { slug } = useParams<{ slug: string }>();
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [chain, setChain] = useState<ChainStatus | null>(null);
  const [action, setAction] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const query = new URLSearchParams({ take: "200", ...(action ? { action } : {}) });
      const [rows, status] = await Promise.all([
        get<AuditEntry[]>(`/events/${slug}/audit?${query}`),
        get<ChainStatus>(`/events/${slug}/audit/verify`),
      ]);
      setEntries(rows);
      setChain(status);
      setError("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "The audit log could not be loaded.");
    }
  }, [slug, action]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!entries) return <PageStatus eyebrow="Audit" error={error} maxWidth="max-w-[980px]" />;

  return (
    <main className="screen max-w-[980px] pb-[120px] pt-[clamp(26px,4vw,40px)]">
      <PageHeader
        eyebrow="Audit · organizer only"
        title="Everything that happened, in order."
        lead="Every entry is chained to the one before it by a SHA-256 hash the database writes itself, and the table refuses edits and deletes. Verifying recomputes the whole chain."
        actions={
          <a href={`${apiBase()}/api/events/${slug}/export/audit.csv`} className="btn btn-sm">
            Export CSV
          </a>
        }
      />

      {chain ? (
        <div
          className={`mt-6 rounded-[10px] px-4 py-3 text-small ${chain.ok ? "bg-elevated text-text" : "bg-danger-soft text-danger"}`}
          role="status"
        >
          {chain.ok ? (
            <>
              <span className="font-medium">Chain intact.</span> {chain.entries} entries verified. Head{" "}
              <code className="font-mono text-meta">{chain.head?.slice(0, 16) ?? "none"}</code>: note it down, and any later
              rewrite of the history will not reproduce it.
            </>
          ) : (
            <>
              <span className="font-medium">Chain broken at entry {chain.firstBreak?.chainSeq ?? "?"}:</span>{" "}
              {chain.firstBreak?.reason}.
            </>
          )}
        </div>
      ) : null}

      <div className="mt-6 flex flex-wrap gap-2" role="group" aria-label="Filter by kind">
        {GROUPS.map((g) => (
          <button
            key={g.label}
            type="button"
            aria-pressed={action === g.actions}
            onClick={() => setAction(g.actions)}
            className={action === g.actions ? "btn-primary btn-sm" : "btn btn-sm"}
          >
            {g.label}
          </button>
        ))}
      </div>

      {error ? <p className="mt-3 text-small text-danger">{error}</p> : null}

      {entries.length === 0 ? (
        <p className="mt-6 text-ui text-muted">Nothing of this kind has been recorded.</p>
      ) : (
        <ul className="m-0 mt-4 list-none p-0">
          {entries.map((entry) => {
            const hasDetail = Object.keys(entry.metadata ?? {}).length > 0;
            return (
              <li key={entry.id} className="m-0 grid gap-3.5 border-b border-line py-3 [grid-template-columns:44px_92px_minmax(0,1fr)]">
                <span className="font-mono text-meta text-muted">#{entry.chainSeq ?? "-"}</span>
                <span className="font-mono text-meta text-muted">
                  {utcDateTime(entry.createdAt, { month: "short", day: "numeric" })}
                </span>
                <div className="min-w-0">
                  <div className="text-ui leading-[1.5] [overflow-wrap:anywhere]">{entry.summary}</div>
                  <div className="mt-1 font-mono text-label text-muted">
                    {entry.actor ? `actor: ${entry.actor.name}` : "system"}
                    {entry.ipHash ? ` · ip ${entry.ipHash.slice(0, 8)}` : ""} · {plain(entry.action)}
                    {entry.hash ? ` · ${entry.hash.slice(0, 10)}` : ""}
                    {hasDetail ? (
                      <button type="button" onClick={() => setOpen(open === entry.id ? null : entry.id)} className="ml-2 underline">
                        {open === entry.id ? "hide detail" : "detail"}
                      </button>
                    ) : null}
                  </div>
                  {open === entry.id ? (
                    <pre className="mt-2 overflow-x-auto rounded-[8px] bg-elevated px-3 py-2 font-mono text-meta">
                      {JSON.stringify(entry.metadata, null, 2)}
                    </pre>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
