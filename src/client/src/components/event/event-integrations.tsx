"use client";

import { useCallback, useEffect, useState } from "react";
import { apiBase, ApiError, del, get, patch, post } from "@/lib/api";
import { Notice } from "@/components/ui/notice";

interface Delivery {
  id: string;
  action: string;
  statusCode: number | null;
  ok: boolean;
  error: string | null;
  createdAt: string;
}

interface Webhook {
  id: string;
  url: string;
  events: string[];
  active: boolean;
  secretHint: string;
  deliveries: Delivery[];
}

interface ImportResult {
  created: string[];
  granted: string[];
  alreadyHeld: string[];
  invalid: string[];
  teams: {
    created: string[];
    joined: Array<{ email: string; team: string }>;
    skipped: Array<{ email: string; team: string; reason: string }>;
  };
}

const ENDPOINTS: Array<{ method: string; path: string; note: string }> = [
  { method: "GET", path: "/api/events/:event/submissions", note: "public gallery" },
  { method: "GET", path: "/api/events/:event/judge/queue", note: "a judge's own queue only" },
  { method: "PUT", path: "/api/events/:event/judge/scores/:submission", note: "cast an evaluation" },
  { method: "GET", path: "/api/events/:event/results", note: "public once published" },
  { method: "POST", path: "/api/events/:event/votes", note: "community ballot" },
  { method: "GET", path: "/api/events/:event/export/event.json", note: "everything, organizer only" },
];

const METHOD_FG: Record<string, string> = {
  GET: "var(--info-fg)",
  POST: "var(--ok-fg)",
  PUT: "var(--warn-fg)",
  DELETE: "var(--err)",
};

export function EventIntegrations({ slug, canEdit }: { slug: string; canEdit: boolean }) {
  const [available, setAvailable] = useState<string[]>([]);
  const [hooks, setHooks] = useState<Webhook[]>([]);
  const [hookUrl, setHookUrl] = useState("");
  const [hookEvents, setHookEvents] = useState<string[]>([]);
  const [newSecret, setNewSecret] = useState("");
  const [certs, setCerts] = useState<{ participants: number; judges: number; admins: number } | null>(null);
  const [importRole, setImportRole] = useState<"JUDGE" | "PARTICIPANT">("JUDGE");
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [origin, setOrigin] = useState("");

  useEffect(() => setOrigin(window.location.origin), []);

  const load = useCallback(async () => {
    if (!canEdit) return;
    try {
      const [w, c] = await Promise.all([
        get<{ available: string[]; hooks: Webhook[] }>(`/events/${slug}/webhooks`),
        get<{ participants: number; judges: number; admins: number }>(`/events/${slug}/certificates/summary`),
      ]);
      setAvailable(w.available);
      setHooks(w.hooks);
      setCerts(c);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Integrations could not be loaded.");
    }
  }, [slug, canEdit]);

  useEffect(() => {
    void load();
  }, [load]);

  async function addHook() {
    setError("");
    setNewSecret("");
    try {
      const created = await post<Webhook & { secret: string }>(`/events/${slug}/webhooks`, {
        url: hookUrl.trim(),
        events: hookEvents,
      });
      setNewSecret(created.secret);
      setHookUrl("");
      setHookEvents([]);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "That webhook could not be added.");
    }
  }

  async function toggleHook(hook: Webhook) {
    try {
      await patch(`/events/${slug}/webhooks/${hook.id}`, { active: !hook.active });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "That webhook could not be changed.");
    }
  }

  async function removeHook(hook: Webhook) {
    try {
      await del(`/events/${slug}/webhooks/${hook.id}`);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "That webhook could not be removed.");
    }
  }

  async function importFile(file: File) {
    setError("");
    setImportResult(null);
    try {
      const csv = await file.text();
      const result = await post<ImportResult>(`/events/${slug}/import/roster`, { role: importRole, csv });
      setImportResult(result);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "That file could not be imported.");
    }
  }

  const embedSnippet = `<iframe src="${origin}/embed/${slug}" width="100%" height="640" style="border:0"></iframe>`;

  return (
    <section className="mt-14">
      <div className="border-b border-line pb-3.5">
        <h2 className="text-title font-semibold tracking-head">API, webhooks and certificates</h2>
        <p className="mt-1.5 text-ui text-muted">Scoped to this event. Everything here has a REST equivalent.</p>
      </div>

      <div className="mt-5 text-ui font-medium">Role isolation, enforced server-side</div>
      <p className="mt-1.5 max-w-[62ch] text-small leading-[1.6] text-muted">
        A judge&apos;s session is scoped to their own evaluations at the API layer, not filtered in the
        client. Asking for another judge&apos;s scores is refused however the request is made.
      </p>
      <pre className="mt-2.5 overflow-x-auto rounded-lg border border-line bg-elevated px-4 py-3.5 font-mono text-small leading-[1.75]">
        {`curl -b judge-session.txt \\\n  ${apiBase()}/api/events/${slug}/scores?judgeId=someone-else\n\n`}
        <span className="text-danger">{`403 {"error":{"code":"forbidden","message":"Only organizers can read the full score set for an event."}}`}</span>
      </pre>

      <div className="mt-6 text-ui font-medium">REST endpoints</div>
      <div className="mt-2.5 overflow-hidden rounded-lg border border-line">
        {ENDPOINTS.map((e) => (
          <div key={e.path} className="flex items-baseline gap-3 border-b border-line bg-surface px-3.5 py-2.5 last:border-b-0">
            <span className="w-[42px] flex-none font-mono text-meta font-semibold" style={{ color: METHOD_FG[e.method] }}>
              {e.method}
            </span>
            <span className="min-w-0 flex-1 truncate font-mono text-small">{e.path}</span>
            <span className="hidden text-meta text-muted sm:inline">{e.note}</span>
          </div>
        ))}
      </div>

      {error ? (
        <Notice className="mt-5">{error}</Notice>
      ) : null}

      {canEdit ? (
        <>
          <div className="mt-6 text-ui font-medium">Webhooks</div>
          <p className="mt-1.5 max-w-[62ch] text-small leading-[1.6] text-muted">
            Each delivery is a JSON POST signed with HMAC-SHA256 in <code className="font-mono">x-podium-signature</code>.
            Deliveries run after the action completes, so a slow receiver never slows an organizer down.
          </p>
          <div className="mt-2.5 flex flex-wrap gap-[7px]">
            {available.map((evt) => {
              const on = hookEvents.includes(evt);
              return (
                <button
                  key={evt}
                  type="button"
                  onClick={() =>
                    setHookEvents((prev) => (on ? prev.filter((x) => x !== evt) : [...prev, evt]))
                  }
                  className="rounded-md border px-2.5 py-[5px] font-mono text-meta [transition:background-color_200ms,border-color_200ms]"
                  style={{
                    background: on ? "var(--acs)" : "var(--el)",
                    borderColor: on ? "var(--ac)" : "var(--ln)",
                    color: on ? "var(--act)" : "var(--tx)",
                  }}
                >
                  {evt.toLowerCase().replace(/_/g, ".")}
                </button>
              );
            })}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <input
              className="field min-w-0 flex-[1_1_280px] font-mono text-small"
              placeholder="https://your-service.example/podium"
              value={hookUrl}
              onChange={(e) => setHookUrl(e.target.value)}
            />
            <button
              type="button"
              onClick={() => void addHook()}
              disabled={!hookUrl.trim() || hookEvents.length === 0}
              className="btn btn-sm disabled:opacity-40"
            >
              Add endpoint
            </button>
          </div>
          {newSecret ? (
            <div className="mt-3 rounded-lg border border-line bg-elevated px-3 py-2.5">
              <div className="font-mono text-label uppercase tracking-stamp text-muted">
                Signing secret, shown once
              </div>
              <code className="mt-1 block select-all break-all font-mono text-small">{newSecret}</code>
            </div>
          ) : null}
          <div className="mt-3 grid gap-2">
            {hooks.map((hook) => (
              <div key={hook.id} className="rounded-lg border border-line bg-surface px-3.5 py-3">
                <div className="flex flex-wrap items-center gap-2.5">
                  <span
                    className="h-[7px] w-[7px] rounded-full"
                    style={{ background: hook.active ? "var(--ac)" : "var(--mu)" }}
                  />
                  <span className="min-w-0 flex-1 truncate font-mono text-small">{hook.url}</span>
                  <span className="font-mono text-label text-muted">secret {hook.secretHint}</span>
                  <button type="button" onClick={() => void toggleHook(hook)} className="btn btn-sm">
                    {hook.active ? "Pause" : "Resume"}
                  </button>
                  <button
                    type="button"
                    onClick={() => void removeHook(hook)}
                    className="btn btn-sm text-muted hover:border-danger hover:text-danger"
                  >
                    Remove
                  </button>
                </div>
                <div className="mt-2 font-mono text-label text-muted">
                  {hook.events.map((e) => e.toLowerCase().replace(/_/g, ".")).join(" · ")}
                </div>
                {hook.deliveries.length ? (
                  <div className="mt-2 grid gap-1">
                    {hook.deliveries.map((d) => (
                      <div key={d.id} className="flex gap-2.5 font-mono text-label">
                        <span style={{ color: d.ok ? "var(--ac)" : "var(--err)" }}>
                          {d.statusCode ?? "failed"}
                        </span>
                        <span className="text-muted">{d.action.toLowerCase()}</span>
                        <span className="ml-auto text-muted">{new Date(d.createdAt).toLocaleTimeString()}</span>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            ))}
          </div>

          <div className="mt-7 grid gap-3.5 [grid-template-columns:repeat(auto-fit,minmax(220px,1fr))]">
            <div className="rounded-[10px] border border-line p-4">
              <div className="text-ui font-medium">Certificates</div>
              <p className="mt-1.5 text-small leading-[1.55] text-muted">
                Signed participation records for every registrant, and a judge&apos;s dated attestation of
                the projects they scored. Each person draws their own from the event page.
              </p>
              <div className="mt-3 font-mono text-meta text-muted">
                {certs
                  ? `${certs.participants} participants · ${certs.judges} judges eligible`
                  : "counting..."}
              </div>
              <a href={`/events/${slug}/certificate`} className="btn-primary btn-sm mt-3 inline-flex">
                Preview my certificate
              </a>
            </div>

            <div className="rounded-[10px] border border-line p-4">
              <div className="text-ui font-medium">Embeddable gallery</div>
              <p className="mt-1.5 text-small leading-[1.55] text-muted">
                Drop this event&apos;s gallery into a sponsor site. It shows only what the public gallery
                already shows.
              </p>
              <code className="mt-3 block select-all overflow-x-auto whitespace-nowrap rounded-md border border-line bg-elevated px-2.5 py-2 font-mono text-label">
                {embedSnippet}
              </code>
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard?.writeText(embedSnippet);
                  setNote("Embed snippet copied.");
                }}
                className="btn btn-sm mt-3"
              >
                Copy snippet
              </button>
            </div>

            <div className="rounded-[10px] border border-line p-4">
              <div className="text-ui font-medium">Bulk import / export</div>
              <p className="mt-1.5 text-small leading-[1.55] text-muted">
                CSV in for rosters and judge panels; a full JSON export of everything out, any time.
              </p>
              <p className="mt-1.5 text-small leading-[1.55] text-muted">
                Columns <code className="font-mono">email</code>, <code className="font-mono">name</code> and, for
                participants, <code className="font-mono">team</code>. New addresses get an account that signs in by
                link; named teams are created as needed.
              </p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {(["JUDGE", "PARTICIPANT"] as const).map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setImportRole(r)}
                    className="pill"
                    style={importRole === r ? { background: "var(--tx)", color: "var(--bg)", borderColor: "var(--tx)" } : undefined}
                  >
                    {r === "JUDGE" ? "Judges" : "Participants"}
                  </button>
                ))}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <label className="btn btn-sm cursor-pointer">
                  Import CSV
                  <input
                    type="file"
                    accept=".csv,text/csv,text/plain"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) void importFile(file);
                      e.target.value = "";
                    }}
                  />
                </label>
                <a href={`${apiBase()}/api/events/${slug}/export/event.json`} className="btn btn-sm">
                  Export everything
                </a>
              </div>
              {importResult ? (
                <div className="mt-3 font-mono text-meta leading-[1.7] text-muted">
                  {importResult.granted.length} granted · {importResult.alreadyHeld.length} already held
                  {importResult.created.length ? ` · ${importResult.created.length} accounts created` : ""}
                  {importResult.invalid.length ? ` · ${importResult.invalid.length} invalid` : ""}
                  {importResult.teams.joined.length
                    ? ` · ${importResult.teams.joined.length} placed on teams (${importResult.teams.created.length} new)`
                    : ""}
                  {importResult.teams.skipped.map((s) => (
                    <div key={s.email}>
                      {s.email}: not placed on {s.team}, {s.reason}
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          </div>

          {note ? (
            <Notice tone="success" className="mt-3.5">{note}</Notice>
          ) : null}

          <div className="mt-6 flex flex-wrap gap-2">
            {["submissions", "teams", "judges", "scores", "results", "audit"].map((kind) => (
              <a key={kind} href={`${apiBase()}/api/events/${slug}/export/${kind}.csv`} className="btn btn-sm font-mono text-meta">
                {kind}.csv
              </a>
            ))}
          </div>
        </>
      ) : null}
    </section>
  );
}
