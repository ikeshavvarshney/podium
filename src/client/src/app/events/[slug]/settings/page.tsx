"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ApiError, get, patch, put } from "@/lib/api";
import { EventIntegrations } from "@/components/event/event-integrations";
import { hue, HUE_NAMES } from "@/lib/hues";
import type { EventDetail } from "@/lib/types";
import { MarkdownEditor } from "@/components/ui/markdown-editor";
import { ScalePicker } from "@/components/event/scale-picker";
import { DEFAULT_CRITERIA, DEFAULT_SCALE } from "@/lib/rubric";
import { Notice } from "@/components/ui/notice";
import { STATUS_LABEL } from "@/lib/hues";
import { ShareLink } from "@/components/event/share-link";
import { StatusChip } from "@/components/ui/status-chip";
import { PageStatus } from "@/components/ui/page-status";
import { Segmented } from "@/components/ui/segmented";
import { toUtcInput, fromUtcInput } from "@/lib/format";

interface Criterion {
  id?: string;
  key: string;
  label: string;
  hint: string | null;
  weight: number;
  minScore: number;
  maxScore: number;
}

interface Rubric {
  id: string;
  name: string;
  mode: "RUBRIC" | "COMPARATIVE";
  groupSize: number;
  lockedAt: string | null;
  criteria: Criterion[];
}

const CRITERION_HUES = ["teal", "blue", "amber", "plum", "rose", "cyan", "coral", "green"];

const toLocalInput = toUtcInput;

const fromLocalInput = fromUtcInput;

function keyFor(label: string, taken: Set<string>): string {
  const base =
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 40) || "criterion";
  let key = base;
  let n = 2;
  while (taken.has(key)) key = `${base}_${n++}`;
  return key;
}

const FIELD =
  "bg-surface border border-line-strong rounded-[10px] px-[13px] py-2.5 text-ui text-text outline-none focus:border-muted";

export default function EventSettingsPage() {
  const params = useParams<{ slug: string }>();
  const slug = params.slug;

  const [event, setEvent] = useState<EventDetail | null>(null);
  // The description is edited as Markdown here and saved when the field loses focus.
  const [descriptionDraft, setDescriptionDraft] = useState<string | null>(null);
  const [rubric, setRubric] = useState<Rubric | null>(null);
  const [criteria, setCriteria] = useState<Criterion[]>([]);
  const [error, setError] = useState("");
  const [detailsSaved, setDetailsSaved] = useState(false);
  const [rubricSaved, setRubricSaved] = useState(false);
  const [rubricError, setRubricError] = useState("");
  const [busy, setBusy] = useState(false);
  const [themeInput, setThemeInput] = useState("");
  const [active, setActive] = useState<number | null>(null);
  const [mode, setMode] = useState<"RUBRIC" | "COMPARATIVE">("RUBRIC");
  const [groupSize, setGroupSize] = useState(4);

  const load = useCallback(async () => {
    try {
      const [e, r] = await Promise.all([
        get<EventDetail>(`/events/${slug}`),
        get<Rubric | null>(`/events/${slug}/rubric`),
      ]);
      setEvent(e);
      setRubric(r);
      setMode(r?.mode === "COMPARATIVE" ? "COMPARATIVE" : "RUBRIC");
      setGroupSize(r?.groupSize ?? 4);
      setCriteria(
        r?.criteria.length
          ? r.criteria.map((c) => ({ ...c }))
          : DEFAULT_CRITERIA.map((c) => ({ ...c, minScore: 1, maxScore: DEFAULT_SCALE })),
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load this event.");
    }
  }, [slug]);

  useEffect(() => {
    void load();
  }, [load]);

  const patchEvent = useCallback(
    async (data: Record<string, unknown>) => {
      setError("");
      try {
        const next = await patch<EventDetail>(`/events/${slug}`, data);
        setEvent((prev) => (prev ? { ...prev, ...next } : next));
        setDetailsSaved(true);
        window.setTimeout(() => setDetailsSaved(false), 1600);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "That change could not be saved.");
      }
    },
    [slug],
  );

  const weightTotal = useMemo(
    () => criteria.reduce((sum, c) => sum + (Number.isFinite(c.weight) ? c.weight : 0), 0),
    [criteria],
  );
  const weightOk = weightTotal === 100 && criteria.every((c) => c.label.trim().length > 0);
  const locked = Boolean(rubric?.lockedAt);

  const donut = useMemo(() => {
    const saved = rubric?.criteria ?? [];
    const total = saved.reduce((s, c) => s + c.weight, 0) || 1;
    let offset = 0;
    const circumference = 2 * Math.PI * 52;
    return saved.map((c, i) => {
      const length = (c.weight / total) * circumference;
      const seg = {
        label: c.label,
        weight: c.weight,
        stroke: hue(CRITERION_HUES[i % CRITERION_HUES.length]!).fg,
        dash: `${length} ${circumference - length}`,
        offset: -offset,
        index: i,
      };
      offset += length;
      return seg;
    });
  }, [rubric]);

  function updateCriterion(index: number, changes: Partial<Criterion>) {
    setCriteria((prev) => prev.map((c, i) => (i === index ? { ...c, ...changes } : c)));
  }

  // One scale for the whole rubric: every criterion is scored 1 to the same number.
  const scale = criteria[0]?.maxScore ?? DEFAULT_SCALE;
  function setScale(next: number) {
    setCriteria((prev) => prev.map((c) => ({ ...c, minScore: 1, maxScore: next })));
  }

  function addCriterion() {
    setCriteria((prev) => [
      ...prev,
      { key: "", label: "", hint: "", weight: 0, minScore: 1, maxScore: scale },
    ]);
  }

  async function saveMode(next: "RUBRIC" | "COMPARATIVE", size: number) {
    if (!rubric) {
      setRubricError("Save a rubric first; the scoring mode is stored with it.");
      return;
    }
    setRubricError("");
    try {
      const updated = await put<Rubric>(`/events/${slug}/rubric`, {
        name: rubric.name,
        mode: next,
        groupSize: size,
        criteria: rubric.criteria.map((c) => ({
          key: c.key,
          label: c.label,
          hint: c.hint,
          weight: c.weight,
          minScore: c.minScore,
          maxScore: c.maxScore,
        })),
      });
      setRubric(updated);
      setMode(next);
      setDetailsSaved(true);
      window.setTimeout(() => setDetailsSaved(false), 1600);
    } catch (err) {
      setRubricError(err instanceof ApiError ? err.message : "The scoring mode could not be saved.");
    }
  }

  async function saveRubric() {
    setBusy(true);
    setRubricError("");
    try {
      const taken = new Set<string>();
      const payload = {
        name: rubric?.name ?? "Default rubric",
        mode,
        groupSize,
        criteria: criteria.map((c) => {
          const key = c.key && c.key.trim() ? c.key.trim() : keyFor(c.label, taken);
          taken.add(key);
          return {
            key,
            label: c.label.trim(),
            hint: c.hint?.trim() ? c.hint.trim() : null,
            weight: Math.round(c.weight),
            minScore: c.minScore,
            maxScore: c.maxScore,
          };
        }),
      };
      const next = await put<Rubric>(`/events/${slug}/rubric`, payload);
      setRubric(next);
      setCriteria(next.criteria.map((c) => ({ ...c })));
      setRubricSaved(true);
      window.setTimeout(() => setRubricSaved(false), 1600);
    } catch (err) {
      setRubricError(err instanceof ApiError ? err.message : "The rubric could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  if (error && !event) {
    return (
      <main className="screen max-w-[900px] pt-[clamp(26px,4vw,40px)]">
        <div className="eyebrow">Event settings</div>
        <h1 className="display mt-3.5 text-page">{error}</h1>
        <Link href="/my-events" className="btn mt-8 inline-flex">
          My events
        </Link>
      </main>
    );
  }

  if (!event) {
    return (
      <PageStatus eyebrow="Event settings" maxWidth="max-w-[900px]" />
    );
  }

  const canEdit = event.viewer.isEventAdmin;

  // Settings are for event admins only. Anyone else gets the same refusal the API would give.
  if (!canEdit) {
    return (
      <PageStatus
        eyebrow="Event settings"
        maxWidth="max-w-[900px]"
        error="Organizer or event admin access is required."
      />
    );
  }

  return (
    <main className="screen max-w-[900px] pt-[clamp(26px,4vw,40px)] pb-[120px]">
      <Link
        href={`/events/${slug}/manage`}
        className="eyebrow mb-4 inline-flex items-center gap-[7px] hover:text-text"
      >
        <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M14 6l-6 6 6 6" />
        </svg>
        Dashboard
      </Link>

      <div className="flex flex-wrap items-baseline gap-2.5">
        <div className="eyebrow">Settings · {event.name}</div>
        {detailsSaved ? <StatusChip tone="success">Saved</StatusChip> : null}
      </div>

      <h1 className="display mt-3.5 text-page">Edit everything about this event.</h1>
      <p className="mt-3 max-w-[62ch] text-ui leading-[1.6] text-muted">
        The same content you set while creating the event. Changes save when you leave a field.
      </p>

      {error ? (
        <Notice className="mt-6">{error}</Notice>
      ) : null}

      <section className="mt-[clamp(28px,4vw,36px)]">
        <div className="border-b border-line pb-3.5">
          <h2 className="text-title font-semibold tracking-head">Event status</h2>
          <p className="m-0 mt-1.5 max-w-[60ch] text-small leading-[1.55] text-muted">
            A draft is private and takes no registrations. Move the event forward when you are ready; dates and windows are still enforced by the server clock.
          </p>
        </div>
        <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="Event status">
          {(["DRAFT", "PUBLISHED", "REGISTRATION_OPEN", "SUBMISSIONS_OPEN", "JUDGING", "VOTING", "RESULTS_PUBLISHED", "ARCHIVED"] as const).map((st) => (
            <button
              key={st}
              type="button"
              aria-pressed={event.status === st}
              disabled={!canEdit}
              onClick={() => event.status !== st && void patchEvent({ status: st })}
              className={`btn btn-sm ${event.status === st ? "!border-[var(--btn-bd)] shadow-[inset_0_0_0_1px_var(--btn-bd)]" : ""}`}
            >
              {STATUS_LABEL[st]}
            </button>
          ))}
        </div>
      </section>

      <section className="mt-[clamp(28px,4vw,36px)]">
        <div className="border-b border-line pb-3.5">
          <h2 className="text-title font-semibold tracking-head">Visibility and sharing</h2>
          <p className="m-0 mt-1.5 max-w-[60ch] text-small leading-[1.55] text-muted">
            Public events appear on Discover. Link only events are hidden from the list but open for anyone with the link. Private events are invisible to anyone without a role.
          </p>
        </div>
        <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="Event visibility">
          {(
            [
              ["PUBLIC", "Public"],
              ["UNLISTED", "Link only"],
              ["PRIVATE", "Private"],
            ] as const
          ).map(([v, label]) => (
            <button
              key={v}
              type="button"
              aria-pressed={event.visibility === v}
              disabled={!canEdit}
              onClick={() => event.visibility !== v && void patchEvent({ visibility: v })}
              className={`btn btn-sm ${event.visibility === v ? "!border-[var(--btn-bd)] shadow-[inset_0_0_0_1px_var(--btn-bd)]" : ""}`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="mt-4 max-w-[560px]">
          <ShareLink
            slug={slug}
            note={
              event.status === "DRAFT"
                ? "This event is still a draft: only people with a role can open the link. Publish it above first."
                : event.visibility === "PRIVATE"
                  ? "This event is private: only people with a role can open the link."
                  : "Anyone with this link can open the event."
            }
          />
        </div>
      </section>

      <section className="mt-[clamp(28px,4vw,36px)]">
        <div className="border-b border-line pb-3.5">
          <h2 className="text-title font-semibold tracking-head">Event details</h2>
        </div>

        <div className="mt-5 grid gap-4">
          <label className="grid gap-[7px]">
            <span className="text-ui font-medium">Name</span>
            <input
              className={FIELD}
              defaultValue={event.name}
              disabled={!canEdit}
              onBlur={(e) => e.target.value !== event.name && patchEvent({ name: e.target.value })}
            />
          </label>

          <label className="grid gap-[7px]">
            <span className="text-ui font-medium">Tagline</span>
            <input
              className={FIELD}
              defaultValue={event.tagline ?? ""}
              disabled={!canEdit}
              onBlur={(e) => e.target.value !== (event.tagline ?? "") && patchEvent({ tagline: e.target.value })}
            />
          </label>

          <MarkdownEditor
            id="settings-description"
            label="Description"
            className={FIELD}
            value={descriptionDraft ?? event.description ?? ""}
            disabled={!canEdit}
            onChange={setDescriptionDraft}
            onBlur={(value) => {
              if (value !== (event.description ?? "")) void patchEvent({ description: value });
            }}
          />

          <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(200px,1fr))]">
            <label className="grid gap-[7px]">
              <span className="text-ui font-medium">Organizer</span>
              <input className={`${FIELD} text-muted`} value={event.owner.org ?? event.owner.name} readOnly />
            </label>
            <label className="grid gap-[7px]">
              <span className="text-ui font-medium">Place</span>
              <input
                className={FIELD}
                defaultValue={event.place ?? ""}
                placeholder="Lisbon + online"
                disabled={!canEdit}
                onBlur={(e) => e.target.value !== (event.place ?? "") && patchEvent({ place: e.target.value || null })}
              />
            </label>
          </div>

          <div>
            <span className="text-ui font-medium">Mode</span>
            <div className="mt-2.5 flex flex-wrap gap-[7px]">
              {(
                [
                  { id: "ONLINE", label: "Online" },
                  { id: "IN_PERSON", label: "In-person" },
                  { id: "HYBRID", label: "Hybrid" },
                ] as const
              ).map((m) => {
                const on = (event.mode ?? "HYBRID") === m.id;
                return (
                  <button
                    key={m.id}
                    type="button"
                    disabled={!canEdit}
                    onClick={() => patchEvent({ mode: m.id })}
                    className="pill active:scale-95"
                    style={on ? { background: "var(--tx)", color: "var(--bg)", borderColor: "var(--tx)" } : undefined}
                  >
                    {m.label}
                  </button>
                );
              })}
            </div>
          </div>

          <label className="grid gap-[7px]">
            <span className="text-ui font-medium">Eligibility</span>
            <input
              className={FIELD}
              defaultValue={event.eligibility}
              disabled={!canEdit}
              onBlur={(e) => e.target.value !== event.eligibility && patchEvent({ eligibility: e.target.value })}
            />
          </label>

          <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(200px,1fr))]">
            {(
              [
                ["registrationOpensAt", "Registration opens"],
                ["registrationClosesAt", "Registration closes"],
                ["submissionsOpenAt", "Submissions open"],
                ["submissionDeadline", "Submission deadline"],
                ["judgingOpensAt", "Judging opens"],
                ["judgingClosesAt", "Judging closes"],
                ["votingOpensAt", "Voting opens"],
                ["votingClosesAt", "Voting closes"],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="grid gap-[7px]">
                <span className="text-ui font-medium">{label} (UTC)</span>
                <input
                  type="datetime-local"
                  className={FIELD}
                  defaultValue={toLocalInput(event[key])}
                  disabled={!canEdit}
                  onBlur={(e) => {
                    const next = fromLocalInput(e.target.value);
                    if (next !== (event[key] ?? null)) void patchEvent({ [key]: next });
                  }}
                />
              </label>
            ))}
          </div>
          <p className="-mt-2 text-small leading-[1.5] text-muted">
            The server enforces every window. Leave one empty to have no limit on that side.
          </p>

          <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(150px,1fr))]">
            <label className="grid gap-[7px]">
              <span className="text-ui font-medium">Team min</span>
              <input
                type="number"
                min={1}
                max={20}
                className={`${FIELD} font-mono`}
                defaultValue={event.minTeamSize}
                disabled={!canEdit}
                onBlur={(e) => patchEvent({ minTeamSize: Number(e.target.value) })}
              />
            </label>
            <label className="grid gap-[7px]">
              <span className="text-ui font-medium">Team max</span>
              <input
                type="number"
                min={1}
                max={20}
                className={`${FIELD} font-mono`}
                defaultValue={event.maxTeamSize}
                disabled={!canEdit}
                onBlur={(e) => patchEvent({ maxTeamSize: Number(e.target.value) })}
              />
            </label>
            <label className="grid gap-[7px]">
              <span className="text-ui font-medium">Judges per project</span>
              <span className="text-small leading-[1.5] text-muted">Auto-balance fills to this. Manual assignment is not limited by it.</span>
              <input
                type="number"
                min={1}
                max={20}
                className={`${FIELD} font-mono`}
                defaultValue={event.reviewsPerSubmission}
                disabled={!canEdit}
                onBlur={(e) => patchEvent({ reviewsPerSubmission: Number(e.target.value) })}
              />
            </label>
          </div>

          <div>
            <span className="text-ui font-medium">Themes</span>
            <div className="mt-2.5 flex flex-wrap gap-[7px]">
              {event.themeTags.map((tag, i) => {
                const h = hue(HUE_NAMES[(i + 2) % HUE_NAMES.length]!);
                return (
                  <button
                    key={tag}
                    type="button"
                    disabled={!canEdit}
                    onClick={() => patchEvent({ themeTags: event.themeTags.filter((t) => t !== tag) })}
                    className="pill"
                    style={{ background: h.bg, color: h.fg, borderColor: "transparent" }}
                    title="Remove theme"
                  >
                    {tag} ×
                  </button>
                );
              })}
            </div>
            <div className="mt-2.5 flex flex-wrap gap-2">
              <input
                className={`${FIELD} flex-1 min-w-[200px]`}
                placeholder="Add a theme"
                value={themeInput}
                disabled={!canEdit}
                onChange={(e) => setThemeInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== "Enter" || !themeInput.trim()) return;
                  e.preventDefault();
                  const tag = themeInput.trim();
                  if (!event.themeTags.includes(tag)) {
                    void patchEvent({ themeTags: [...event.themeTags, tag] });
                  }
                  setThemeInput("");
                }}
              />
            </div>
          </div>
        </div>
      </section>

      <section className="mt-[clamp(28px,4vw,36px)]">
        <div className="border-b border-line pb-3.5">
          <h2 className="text-title font-semibold tracking-head">Scoring mode</h2>
          <p className="mt-1.5 max-w-[62ch] text-ui text-muted">
            {mode === "COMPARATIVE"
              ? "Judges order small groups of projects best to worst; a Borda count combines the orders. Nothing to calibrate, but no per-criterion feedback."
              : "Judges score each criterion on the rubric below; the server computes the weighted total and normalizes across judges."}
          </p>
        </div>
        <Segmented
          label="Judging mode"
          className="mt-[18px] max-w-[460px]"
          value={mode}
          onChange={(id) => void saveMode(id, groupSize)}
          options={[
            { id: "RUBRIC", label: "Weighted rubric", disabled: !canEdit || locked },
            { id: "COMPARATIVE", label: "Comparative ranking", disabled: !canEdit || locked },
          ]}
        />
        {mode === "COMPARATIVE" ? (
          <div className="mt-[18px] flex max-w-[460px] items-center gap-[18px]">
            <div className="min-w-0 flex-1">
              <div className="text-ui font-medium">Projects per group</div>
              <p className="mt-1 text-small leading-[1.5] text-muted">
                The judge arranges this many projects into a ranked order at a time, instead of scoring one in isolation.
              </p>
            </div>
            <input
              type="range"
              min={2}
              max={6}
              step={1}
              value={groupSize}
              disabled={!canEdit || locked}
              onChange={(e) => setGroupSize(Number(e.target.value))}
              onMouseUp={() => void saveMode(mode, groupSize)}
              onKeyUp={() => void saveMode(mode, groupSize)}
              className="w-[120px] flex-none accent-[var(--ac)]"
            />
            <span className="w-5 flex-none text-right font-mono text-prose">{groupSize}</span>
          </div>
        ) : null}
        {locked ? (
          <p className="mt-3 text-small text-muted">The mode is frozen once the first ballot is cast.</p>
        ) : null}
      </section>

      {mode === "COMPARATIVE" ? null : (
      <section className="mt-14">
        <div className="border-b border-line pb-3.5">
          <h2 className="text-title font-semibold tracking-head">Rubric criteria &amp; weights</h2>
          <p className="mt-1.5 text-ui text-muted">
            Add, remove or rename criteria freely. Weights must total 100 to save, and judging stays on the last
            saved rubric until then.
          </p>
        </div>

        <div className="mt-5">
          <ScalePicker value={scale} onChange={setScale} disabled={locked || !canEdit} />
        </div>

        {donut.length ? (
          <div className="mt-6 grid items-center gap-[22px] [grid-template-columns:repeat(auto-fit,minmax(150px,1fr))]">
            <svg viewBox="0 0 140 140" className="block h-auto w-full max-w-[150px]" role="img" aria-label="Share of the rubric carried by each criterion">
              <circle cx="70" cy="70" r="52" fill="none" stroke="var(--el)" strokeWidth="12" />
              {donut.map((d) => (
                <circle
                  key={d.label}
                  cx="70"
                  cy="70"
                  r="52"
                  fill="none"
                  stroke={d.stroke}
                  strokeWidth={active === d.index ? 18 : 12}
                  strokeOpacity={active === null || active === d.index ? 1 : 0.45}
                  strokeDasharray={d.dash}
                  strokeDashoffset={d.offset}
                  transform="rotate(-90 70 70)"
                  className="cursor-pointer [transition:stroke-width_420ms_cubic-bezier(0.33,1,0.68,1)_60ms,stroke-opacity_220ms]"
                  onMouseEnter={() => setActive(d.index)}
                  onMouseLeave={() => setActive(null)}
                />
              ))}
            </svg>
            <div className="min-w-0">
              <div className="text-ui leading-[1.55]">
                {active === null
                  ? "Every ballot is weighted by these shares before any normalization runs."
                  : `${donut[active]!.label} carries ${donut[active]!.weight}% of a project's total.`}
              </div>
              <div className="mt-3 flex flex-wrap gap-y-[9px] gap-x-4">
                {donut.map((d) => (
                  <span
                    key={d.label}
                    onMouseEnter={() => setActive(d.index)}
                    onMouseLeave={() => setActive(null)}
                    className="inline-flex cursor-pointer items-center gap-[7px] text-small text-muted"
                  >
                    <span className="h-[9px] w-[9px] rounded-[3px]" style={{ background: d.stroke }} />
                    {d.label}
                  </span>
                ))}
              </div>
            </div>
          </div>
        ) : null}

        {locked ? (
          <div className="mt-6 rounded-[10px] bg-danger-soft px-[13px] py-2.5 text-small text-danger">
            Ballots have already been cast against this rubric, so it is frozen. Changing a weight underneath cast
            ballots would silently rewrite past results.
          </div>
        ) : (
          <p className="mt-6 text-ui text-muted">
            Editing the current, unsaved draft. The chart above reflects the last saved rubric.
          </p>
        )}

        {criteria.map((c, i) => (
          <div
            key={i}
            className="grid items-start gap-2.5 border-b border-line py-[13px] [grid-template-columns:minmax(0,1fr)_90px_34px]"
          >
            <div className="grid min-w-0 gap-1.5">
              <input
                className="rounded-md border border-line bg-surface px-2.5 py-[7px] text-ui font-medium text-text outline-none focus:border-muted"
                placeholder="Criterion name"
                value={c.label}
                disabled={locked || !canEdit}
                onChange={(e) => updateCriterion(i, { label: e.target.value })}
              />
              <input
                className="rounded-md border border-line bg-surface px-2.5 py-[7px] text-small text-muted outline-none focus:border-muted"
                placeholder="What judges should look for"
                value={c.hint ?? ""}
                disabled={locked || !canEdit}
                onChange={(e) => updateCriterion(i, { hint: e.target.value })}
              />
            </div>
            <div className="flex items-center gap-1">
              <input
                type="number"
                min={0}
                max={100}
                className="w-full rounded-md border border-line bg-surface px-2 py-[7px] font-mono text-ui text-text outline-none focus:border-muted"
                value={c.weight}
                disabled={locked || !canEdit}
                onChange={(e) => updateCriterion(i, { weight: Number(e.target.value) })}
              />
              <span className="text-small text-muted">%</span>
            </div>
            <button
              type="button"
              aria-label="Remove criterion"
              title="Remove criterion"
              disabled={locked || !canEdit || criteria.length === 1}
              onClick={() => setCriteria((prev) => prev.filter((_, j) => j !== i))}
              className="h-[34px] w-[34px] self-center rounded-md border border-line bg-surface text-body text-muted enabled:hover:border-danger enabled:hover:text-danger disabled:opacity-40"
            >
              ×
            </button>
          </div>
        ))}

        <button
          type="button"
          onClick={addCriterion}
          disabled={locked || !canEdit}
          className="mt-3.5 rounded-[10px] border border-dashed border-line px-3.5 py-[9px] text-small text-text hover:border-muted disabled:opacity-40"
        >
          + Add criterion
        </button>

        <div className="flex items-center justify-between gap-4 pt-5">
          <span className="text-ui text-muted">Draft total</span>
          <span
            className="font-mono text-title"
            style={{ color: weightTotal === 100 ? "var(--ac)" : "var(--err)" }}
          >
            {weightTotal}
          </span>
        </div>

        {weightTotal !== 100 ? (
          <div className="mt-3 rounded-[10px] bg-danger-soft px-[13px] py-2.5 text-small text-danger">
            Weights total {weightTotal}%. They must total exactly 100% before the rubric can be saved.
          </div>
        ) : null}
        {rubricError ? (
          <Notice className="mt-3">{rubricError}</Notice>
        ) : null}

        <div className="mt-3.5 flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => void saveRubric()}
            disabled={!weightOk || busy || locked || !canEdit}
            title={weightOk ? undefined : "Weights must total 100%"}
            className="btn-primary disabled:opacity-40"
          >
            {busy ? "Saving..." : "Save rubric"}
          </button>
          {rubricSaved ? <StatusChip tone="success">Saved</StatusChip> : null}
        </div>
      </section>
      )}

      <EventIntegrations slug={slug} canEdit={canEdit} />
    </main>
  );
}
