"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ApiError, get, patch, post, put } from "@/lib/api";
import { slugify, type SlugCheck } from "@/lib/slug";
import { ShareLink } from "@/components/event/share-link";
import { hue } from "@/lib/hues";
import { Notice } from "@/components/ui/notice";
import { Field } from "@/components/ui/field";
import { MarkdownEditor } from "@/components/ui/markdown-editor";

const STEPS = [
  { label: "Basics", note: "Name it and say what it is for." },
  { label: "Timeline", note: "Set the windows the server will enforce." },
  { label: "Tracks & prizes", note: "Group the submissions and reward them." },
  { label: "Rubric", note: "Decide what every evaluation is scored against." },
  { label: "Judges", note: "Choose who judges, and who may see the event." },
  { label: "Review", note: "Check everything before the draft is created." },
];

const DRAFT_KEY = "podium.new-event-draft";

const MODES = [
  { id: "ONLINE", label: "Online" },
  { id: "IN_PERSON", label: "In-person" },
  { id: "HYBRID", label: "Hybrid" },
] as const;

const ELIGIBILITY = ["Open to all", "Students only", "Teams of 2+", "First-time hackers", "Invite only"];

interface PrizeRow {
  title: string;
  amount: string;
}

interface CriterionRow {
  label: string;
  weight: number;
}

const FIELD =
  "bg-surface border border-line-strong rounded-[10px] px-[13px] py-2.5 text-ui text-text outline-none focus:border-muted";

function chipStyle(on: boolean, _name?: string) {
  // A chosen option is always the brand tone; the name only documents the call site.
  const h = hue("brand");
  return on
    ? { background: h.bg, color: h.fg, borderColor: "transparent" }
    : undefined;
}

export default function CreateEventPage() {
  const router = useRouter();

  const [step, setStep] = useState(0);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<{ slug: string; name: string; published: boolean } | null>(null);

  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  // Until the organizer types a link, it follows the name.
  const [slugEdited, setSlugEdited] = useState(false);
  const [slugCheck, setSlugCheck] = useState<SlugCheck | "checking" | null>(null);
  const [origin, setOrigin] = useState("");
  const [tagline, setTagline] = useState("");
  const [description, setDescription] = useState("");
  const [themeInput, setThemeInput] = useState("");
  const [themeTags, setThemeTags] = useState<string[]>([]);
  const [mode, setMode] = useState<"ONLINE" | "IN_PERSON" | "HYBRID">("HYBRID");
  const [place, setPlace] = useState("");
  const [tried, setTried] = useState(false);
  const [restored, setRestored] = useState(false);

  const [registrationClosesAt, setRegistrationClosesAt] = useState("");
  const [submissionsOpenAt, setSubmissionsOpenAt] = useState("");
  const [submissionDeadline, setSubmissionDeadline] = useState("");
  const [judgingClosesAt, setJudgingClosesAt] = useState("");
  const [teamMin, setTeamMin] = useState(1);
  const [teamMax, setTeamMax] = useState(4);

  const [trackInput, setTrackInput] = useState("");
  const [tracks, setTracks] = useState<string[]>([]);
  const [prizes, setPrizes] = useState<PrizeRow[]>([
    { title: "First place", amount: "" },
    { title: "Runner-up", amount: "" },
  ]);

  const [criteria, setCriteria] = useState<CriterionRow[]>([
    { label: "Technical depth", weight: 40 },
    { label: "Innovation", weight: 25 },
    { label: "Impact", weight: 20 },
    { label: "Craft", weight: 15 },
  ]);

  const [judgeInput, setJudgeInput] = useState("");
  const [judges, setJudges] = useState<string[]>([]);
  const [eligibility, setEligibility] = useState(ELIGIBILITY[0]!);
  const [visibility, setVisibility] = useState<"PUBLIC" | "UNLISTED" | "PRIVATE">("PUBLIC");
  const [reviewsPerSubmission, setReviewsPerSubmission] = useState(3);

  const weightSum = useMemo(() => criteria.reduce((s, c) => s + (c.weight || 0), 0), [criteria]);

  // The draft lives in this browser until it is created, so a reload or a
  // closed tab does not lose a half-finished event. Nothing is sent early.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (raw) {
        const d = JSON.parse(raw);
        setName(d.name ?? "");
        setSlug(d.slug ?? "");
        setSlugEdited(Boolean(d.slugEdited));
        setTagline(d.tagline ?? "");
        setDescription(d.description ?? "");
        setThemeTags(d.themeTags ?? []);
        setMode(d.mode ?? "HYBRID");
        setPlace(d.place ?? "");
        setRegistrationClosesAt(d.registrationClosesAt ?? "");
        setSubmissionsOpenAt(d.submissionsOpenAt ?? "");
        setSubmissionDeadline(d.submissionDeadline ?? "");
        setJudgingClosesAt(d.judgingClosesAt ?? "");
        setTeamMin(d.teamMin ?? 1);
        setTeamMax(d.teamMax ?? 4);
        setTracks(d.tracks ?? []);
        if (d.prizes) setPrizes(d.prizes);
        if (d.criteria) setCriteria(d.criteria);
        setJudges(d.judges ?? []);
        if (d.eligibility) setEligibility(d.eligibility);
        if (d.visibility) setVisibility(d.visibility);
        setReviewsPerSubmission(d.reviewsPerSubmission ?? 3);
      }
    } catch {
      // Storage can be unavailable; the wizard still works without a draft.
    }
    setRestored(true);
  }, []);

  useEffect(() => {
    if (!restored) return;
    try {
      localStorage.setItem(
        DRAFT_KEY,
        JSON.stringify({
          name, slug, slugEdited, tagline, description, themeTags, mode, place,
          registrationClosesAt, submissionsOpenAt, submissionDeadline, judgingClosesAt,
          teamMin, teamMax, tracks, prizes, criteria, judges, eligibility, visibility,
          reviewsPerSubmission,
        }),
      );
    } catch {
      // Same as above.
    }
  }, [
    restored, name, slug, slugEdited, tagline, description, themeTags, mode, place,
    registrationClosesAt, submissionsOpenAt, submissionDeadline, judgingClosesAt,
    teamMin, teamMax, tracks, prizes, criteria, judges, eligibility, visibility,
    reviewsPerSubmission,
  ]);

  useEffect(() => setOrigin(window.location.origin), []);

  useEffect(() => {
    if (!slugEdited) setSlug(slugify(name));
  }, [name, slugEdited]);

  // Ask the server whether the link is free, a moment after typing stops.
  useEffect(() => {
    if (!slug) {
      setSlugCheck(null);
      return;
    }
    setSlugCheck("checking");
    let cancelled = false;
    const timer = window.setTimeout(() => {
      get<SlugCheck>(`/events/slug-availability?slug=${encodeURIComponent(slug)}`)
        .then((check) => {
          if (!cancelled) setSlugCheck(check);
        })
        .catch(() => {
          if (!cancelled) setSlugCheck(null);
        });
    }, 350);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [slug]);

  const stepError = useMemo(() => {
    if (step === 0) {
      if (!name.trim()) return "An event name is required.";
      if (!slug) return "The event needs a link.";
      if (slugCheck === "checking") return "Checking the event link...";
      if (slugCheck && !slugCheck.available) return `Choose another event link: ${slugCheck.reason}`;
      return "";
    }
    if (step === 1) {
      if (!submissionDeadline) return "A submission deadline is required: the server enforces it.";
      if (teamMin < 1 || teamMax < teamMin) return "Team size must run from at least 1 upwards.";
      return "";
    }
    if (step === 3) {
      if (criteria.some((c) => !c.label.trim())) return "Every criterion needs a name.";
      if (weightSum !== 100) return `Weights total ${weightSum}%. They must total exactly 100%.`;
      return "";
    }
    return "";
  }, [step, name, slug, slugCheck, submissionDeadline, teamMin, teamMax, criteria, weightSum]);

  function iso(value: string): string | undefined {
    if (!value) return undefined;
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
  }

  async function submit(publish: boolean) {
    setBusy(true);
    setError("");
    try {
      const event = await post<{ id: string; slug: string; name: string }>("/events", {
        name: name.trim(),
        slug,
        tagline: tagline.trim() || undefined,
        description: description.trim() || undefined,
        themeTags,
        visibility,
        eligibility,
        mode,
        place: place.trim() || null,
        minTeamSize: teamMin,
        maxTeamSize: teamMax,
        reviewsPerSubmission,
        registrationClosesAt: iso(registrationClosesAt),
        submissionsOpenAt: iso(submissionsOpenAt),
        submissionDeadline: iso(submissionDeadline),
        judgingClosesAt: iso(judgingClosesAt),
      });

      const createdTracks: Array<{ id: string; name: string }> = [];
      for (const track of tracks) {
        createdTracks.push(await post(`/events/${event.slug}/tracks`, { name: track }));
      }

      for (const prize of prizes.filter((p) => p.title.trim())) {
        const amount = Number(prize.amount.replace(/[^0-9.]/g, ""));
        await post(`/events/${event.slug}/prizes`, {
          title: prize.title.trim(),
          amountCents: Number.isFinite(amount) && amount > 0 ? Math.round(amount * 100) : null,
        });
      }

      await put(`/events/${event.slug}/rubric`, {
        name: "Default rubric",
        criteria: criteria.map((c) => ({
          key: c.label
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "_")
            .replace(/^_+|_+$/g, "")
            .slice(0, 40),
          label: c.label.trim(),
          weight: Math.round(c.weight),
          minScore: 1,
          maxScore: 10,
        })),
      });

      const failedJudges: string[] = [];
      for (const email of judges) {
        try {
          await post(`/events/${event.slug}/members`, { email, role: "JUDGE" });
        } catch {
          failedJudges.push(email);
        }
      }

      if (publish) await patch(`/events/${event.slug}`, { status: "PUBLISHED" });
      setCreated({ slug: event.slug, name: event.name, published: publish });
      try {
        localStorage.removeItem(DRAFT_KEY);
      } catch {
        // Nothing to clear.
      }
      if (failedJudges.length) {
        setError(
          `The event was created, but no account exists yet for ${failedJudges.join(", ")}. Grant those roles from Manage roles once they sign up.`,
        );
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "The event could not be created.");
    } finally {
      setBusy(false);
    }
  }

  if (created) {
    return (
      <main className="screen max-w-[1180px] pt-[clamp(26px,4vw,40px)] pb-[120px]">
        <div className="card mt-[clamp(24px,4vw,38px)] max-w-[720px] p-[clamp(24px,4vw,40px)]">
          <div className="eyebrow text-accent">{created.published ? "Event published" : "Draft saved"}</div>
          <h1 className="display mt-3.5 text-hero">{created.name}</h1>
          <p className="mt-4 max-w-[56ch] text-body leading-[1.65] text-muted">
            {created.published
              ? "Your event is live. Share the link below so people can find it and register."
              : "Saved as a draft. It stays private and takes no registrations until you publish it, so tracks, rubric and judges can still change."}
          </p>
          <div className="mt-5 max-w-[560px]">
            <ShareLink
              slug={created.slug}
              note={created.published ? undefined : "Only you and the people you grant a role can open this link until you publish."}
            />
          </div>
          {error ? (
            <Notice className="mt-5">{error}</Notice>
          ) : null}
          <div className="mt-6 flex flex-wrap gap-2.5">
            <Link href={`/events/${created.slug}/manage`} className="btn-primary">
              Open the dashboard
            </Link>
            <Link href={`/events/${created.slug}/settings`} className="btn">
              Settings and rubric
            </Link>
            <button type="button" onClick={() => router.refresh()} className="btn">
              Back to my events
            </button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="screen max-w-[1180px] pt-[clamp(26px,4vw,40px)] pb-[120px]">
      <Link href="/my-events" className="eyebrow inline-flex items-center gap-[7px] hover:text-text">
        <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M14 6l-6 6 6 6" />
        </svg>
        My events
      </Link>

      <h1 className="display mt-3.5 max-w-[20ch] text-hero">Create an event</h1>
      <p className="mt-4 max-w-[58ch] text-body leading-[1.6] text-muted">
        Six steps. Everything stays editable until you open registration.
      </p>

      <div className="mt-[clamp(26px,4vw,38px)] flex flex-wrap items-start gap-[clamp(24px,4vw,46px)]">
        <aside className="grid min-w-[180px] max-w-[240px] flex-[1_1_190px] gap-1">
          {STEPS.map((s, i) => {
            const on = step === i;
            return (
              <button
                key={s.label}
                type="button"
                onClick={() => setStep(i)}
                className="flex items-center gap-[11px] rounded-lg border px-3 py-2.5 text-left [transition:background-color_200ms,border-color_200ms,color_200ms]"
                style={{
                  background: on ? "var(--el)" : "transparent",
                  borderColor: on ? "var(--mu)" : "var(--ln)",
                  color: on ? "var(--tx)" : "var(--mu)",
                }}
              >
                <span
                  className="h-2 w-2 flex-none rounded-full"
                  style={{ background: i < step ? "var(--ac)" : on ? "var(--tx)" : "var(--ln)" }}
                />
                <span className="font-mono text-label text-muted">{String(i + 1).padStart(2, "0")}</span>
                <span className="text-ui">{s.label}</span>
              </button>
            );
          })}
        </aside>

        <div className="min-w-0 flex-[999_1_420px]">
          <div className="eyebrow">Step {STEPS[step]!.label}</div>
          <h2 className="mt-2.5 text-heading font-semibold tracking-head">{STEPS[step]!.note}</h2>

          {step === 0 ? (
            <div className="mt-3">
              <Field label="Event name" hint="Shown in the listing and on the event page." bordered>
                <input className={FIELD} value={name} onChange={(e) => setName(e.target.value)} placeholder="Gridshift '27" />
              </Field>
              <div className="grid gap-[7px] border-b border-line py-4">
                <label htmlFor="event-slug" className="text-ui font-medium">
                  Event link
                </label>
                <div className="flex min-w-0 items-stretch overflow-hidden rounded-[10px] border border-line-strong bg-surface focus-within:border-[var(--btn-bd)]">
                  <span className="flex max-w-[55%] flex-none items-center truncate border-r border-line bg-elevated px-3 font-mono text-small text-muted">
                    {origin.replace(/^https?:\/\//, "")}/events/
                  </span>
                  <input
                    id="event-slug"
                    className="min-w-0 flex-1 bg-transparent px-3 py-2.5 font-mono text-small outline-none"
                    value={slug}
                    onChange={(e) => {
                      setSlugEdited(true);
                      setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 60));
                    }}
                    placeholder="gridshift-27"
                    spellCheck={false}
                    autoCapitalize="none"
                    aria-describedby="event-slug-note"
                    aria-invalid={slugCheck && slugCheck !== "checking" && !slugCheck.available ? true : undefined}
                  />
                </div>
                <p id="event-slug-note" role="status" className="m-0 text-small leading-[1.5] text-muted">
                  {slug && slugCheck === "checking" ? (
                    "Checking..."
                  ) : slug && slugCheck && slugCheck !== "checking" && slugCheck.available ? (
                    <span style={{ color: "var(--ac)" }}>Available. This is the address you share.</span>
                  ) : slug && slugCheck && slugCheck !== "checking" ? (
                    <span style={{ color: "var(--err)" }}>
                      {slugCheck.reason}
                      {slugCheck.suggestion ? (
                        <>
                          {" "}
                          <button
                            type="button"
                            className="border-0 bg-transparent p-0 text-small underline"
                            onClick={() => {
                              setSlugEdited(true);
                              setSlug(slugCheck.suggestion!);
                            }}
                          >
                            Use {slugCheck.suggestion}
                          </button>
                        </>
                      ) : null}
                    </span>
                  ) : (
                    "Lowercase letters, numbers and hyphens. This is the address you share."
                  )}
                </p>
                {slugEdited ? (
                  <button
                    type="button"
                    className="justify-self-start border-0 bg-transparent p-0 text-small text-muted underline"
                    onClick={() => setSlugEdited(false)}
                  >
                    Follow the event name again
                  </button>
                ) : null}
              </div>
              <Field label="Tagline" hint="Under 90 characters reads best in the listing." bordered>
                <input className={FIELD} value={tagline} onChange={(e) => setTagline(e.target.value)} placeholder="One line on what participants will build" />
              </Field>
              <div className="border-b border-line py-4">
                <MarkdownEditor
                  id="event-description"
                  label="Description"
                  className={FIELD}
                  value={description}
                  onChange={setDescription}
                  placeholder={"## What this is\nWho it is for, and what a good submission looks like.\n\n- Build window: one weekend\n- Teams of one to four"}
                />
              </div>
              <div className="grid gap-[7px] border-b border-line py-4">
                <label className="text-ui font-medium">Mode</label>
                <div className="flex flex-wrap gap-[7px]">
                  {MODES.map((m) => (
                    <button key={m.id} type="button" onClick={() => setMode(m.id)} className="pill active:scale-95" style={chipStyle(mode === m.id, "teal")}>
                      {m.label}
                    </button>
                  ))}
                </div>
              </div>
              {mode !== "ONLINE" ? (
                <Field label="Location" hint="Venue or city. Online events can leave this empty." bordered>
                  <input className={FIELD} value={place} onChange={(e) => setPlace(e.target.value)} placeholder="Rotterdam + online" />
                </Field>
              ) : null}
              <div className="grid gap-[7px] border-b border-line py-4">
                <label className="text-ui font-medium">Themes</label>
                <div className="flex flex-wrap gap-[7px]">
                  {themeTags.map((t, i) => (
                    <button
                      key={t}
                      type="button"
                      className="pill"
                      style={chipStyle(true, ["teal", "blue", "amber", "plum"][i % 4]!)}
                      onClick={() => setThemeTags((prev) => prev.filter((x) => x !== t))}
                    >
                      {t} ×
                    </button>
                  ))}
                </div>
                <input
                  className={FIELD}
                  value={themeInput}
                  placeholder="Add a theme, then press Enter"
                  onChange={(e) => setThemeInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key !== "Enter" || !themeInput.trim()) return;
                    e.preventDefault();
                    setThemeTags((prev) => Array.from(new Set([...prev, themeInput.trim()])));
                    setThemeInput("");
                  }}
                />
              </div>
            </div>
          ) : null}

          {step === 1 ? (
            <div className="mt-3">
              {[
                { label: "Registration closes", value: registrationClosesAt, set: setRegistrationClosesAt, required: false },
                { label: "Submissions open", value: submissionsOpenAt, set: setSubmissionsOpenAt, required: false },
                { label: "Submission deadline", value: submissionDeadline, set: setSubmissionDeadline, required: true },
                { label: "Judging closes", value: judgingClosesAt, set: setJudgingClosesAt, required: false },
              ].map((f) => (
                <div key={f.label} className="grid gap-[7px] border-b border-line py-4">
                  <div className="flex items-baseline gap-2.5">
                    <label className="text-ui font-medium">{f.label}</label>
                    <span className="ml-auto font-mono text-label uppercase tracking-stamp text-muted">
                      {f.required ? "required" : "optional"}
                    </span>
                  </div>
                  <input
                    type="datetime-local"
                    className={`${FIELD} font-mono text-small`}
                    value={f.value}
                    onChange={(e) => f.set(e.target.value)}
                  />
                </div>
              ))}
              <div className="grid gap-[7px] border-b border-line py-4">
                <label className="text-ui font-medium">Team size</label>
                <div className="flex flex-wrap items-center gap-2.5">
                  <input
                    type="number"
                    min={1}
                    max={20}
                    aria-label="Smallest team"
                    className={`${FIELD} w-[82px] font-mono text-small`}
                    value={teamMin}
                    onChange={(e) => setTeamMin(Number(e.target.value))}
                  />
                  <span className="text-ui text-muted">to</span>
                  <input
                    type="number"
                    min={1}
                    max={20}
                    aria-label="Largest team"
                    className={`${FIELD} w-[82px] font-mono text-small`}
                    value={teamMax}
                    onChange={(e) => setTeamMax(Number(e.target.value))}
                  />
                  <span className="text-small leading-[1.5] text-muted">people per submission</span>
                </div>
              </div>
              <Field label="Reviews per project" hint="How many independent ballots each project should collect. Assignment fills to this number." bordered>
                <input
                  type="number"
                  min={1}
                  max={20}
                  className={`${FIELD} w-[82px] font-mono text-small`}
                  value={reviewsPerSubmission}
                  onChange={(e) => setReviewsPerSubmission(Number(e.target.value))}
                />
              </Field>
            </div>
          ) : null}

          {step === 2 ? (
            <div className="mt-3">
              <div className="grid gap-[7px] border-b border-line py-4">
                <label className="text-ui font-medium">Tracks</label>
                <div className="flex flex-wrap gap-[7px]">
                  {tracks.map((t, i) => (
                    <button
                      key={t}
                      type="button"
                      className="pill"
                      style={chipStyle(true, ["teal", "blue", "amber", "plum", "rose"][i % 5]!)}
                      onClick={() => setTracks((prev) => prev.filter((x) => x !== t))}
                    >
                      {t} ×
                    </button>
                  ))}
                </div>
                <input
                  className={FIELD}
                  value={trackInput}
                  placeholder="Add a track, then press Enter"
                  onChange={(e) => setTrackInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key !== "Enter" || !trackInput.trim()) return;
                    e.preventDefault();
                    setTracks((prev) => Array.from(new Set([...prev, trackInput.trim()])));
                    setTrackInput("");
                  }}
                />
                <span className="text-small leading-[1.5] text-muted">
                  Tracks route submissions to judges with matching expertise.
                </span>
              </div>

              <div className="eyebrow mt-[clamp(24px,4vw,32px)]">Prizes</div>
              {prizes.map((p, i) => (
                <div key={i} className="flex flex-wrap items-center gap-2.5 border-b border-line py-3">
                  <input
                    aria-label="Prize name"
                    className={`${FIELD} min-w-0 flex-[1_1_200px]`}
                    value={p.title}
                    onChange={(e) =>
                      setPrizes((prev) => prev.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))
                    }
                  />
                  <input
                    aria-label="Prize amount"
                    placeholder="0"
                    className={`${FIELD} flex-[0_1_130px] font-mono text-small`}
                    value={p.amount}
                    onChange={(e) =>
                      setPrizes((prev) => prev.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))
                    }
                  />
                  <button
                    type="button"
                    aria-label="Remove prize"
                    onClick={() => setPrizes((prev) => prev.filter((_, j) => j !== i))}
                    className="h-[34px] w-[34px] rounded-md border border-line bg-surface text-body text-muted hover:border-danger hover:text-danger"
                  >
                    ×
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() => setPrizes((prev) => [...prev, { title: "", amount: "" }])}
                className="mt-3.5 rounded-[10px] border border-dashed border-line px-3.5 py-[9px] text-small hover:border-muted"
              >
                + Add prize
              </button>
              <p className="mt-3 text-small leading-[1.5] text-muted">
                Amounts are per prize, in the event currency. Leave blank for a non-cash prize.
              </p>
            </div>
          ) : null}

          {step === 3 ? (
            <div className="mt-3">
              {criteria.map((c, i) => (
                <div key={i} className="flex flex-wrap items-center gap-3 border-b border-line py-[13px]">
                  <input
                    aria-label="Criterion"
                    className={`${FIELD} min-w-0 flex-[1_1_180px]`}
                    value={c.label}
                    onChange={(e) =>
                      setCriteria((prev) => prev.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))
                    }
                  />
                  <svg viewBox="0 0 100 8" preserveAspectRatio="none" className="block h-2 flex-[1_1_120px]" role="img" aria-label="Weight">
                    <rect x="0" y="0" width="100" height="8" rx="4" fill="var(--el)" />
                    <rect
                      x="0"
                      y="0"
                      width={Math.max(0, Math.min(100, c.weight))}
                      height="8"
                      rx="4"
                      fill="var(--ac)"
                      className="[transition:width_420ms_cubic-bezier(0.33,1,0.68,1)_60ms]"
                    />
                  </svg>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    aria-label="Weight"
                    className={`${FIELD} flex-[0_0_76px] text-right font-mono text-small`}
                    value={c.weight}
                    onChange={(e) =>
                      setCriteria((prev) => prev.map((x, j) => (j === i ? { ...x, weight: Number(e.target.value) } : x)))
                    }
                  />
                  <button
                    type="button"
                    aria-label="Remove criterion"
                    disabled={criteria.length === 1}
                    onClick={() => setCriteria((prev) => prev.filter((_, j) => j !== i))}
                    className="h-[34px] w-[34px] rounded-md border border-line bg-surface text-body text-muted enabled:hover:border-danger enabled:hover:text-danger disabled:opacity-40"
                  >
                    ×
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() => setCriteria((prev) => [...prev, { label: "", weight: 0 }])}
                className="mt-3.5 rounded-[10px] border border-dashed border-line px-3.5 py-[9px] text-small hover:border-muted"
              >
                + Add criterion
              </button>
              <div className="flex items-baseline justify-between gap-4 py-3.5">
                <span className="text-small leading-[1.5] text-muted">
                  Judges score each criterion 1-10; weights turn that into one number.
                </span>
                <span className="font-mono text-ui" style={{ color: weightSum === 100 ? "var(--ac)" : "var(--err)" }}>
                  {weightSum}
                </span>
              </div>
            </div>
          ) : null}

          {step === 4 ? (
            <div className="mt-3">
              <div className="grid gap-[7px] border-b border-line py-4">
                <label className="text-ui font-medium">Invite judges by email</label>
                <div className="flex flex-wrap gap-2">
                  <input
                    className={`${FIELD} min-w-0 flex-[1_1_220px] font-mono text-small`}
                    placeholder="judge@university.edu"
                    value={judgeInput}
                    onChange={(e) => setJudgeInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key !== "Enter" || !judgeInput.trim()) return;
                      e.preventDefault();
                      setJudges((prev) => Array.from(new Set([...prev, judgeInput.trim().toLowerCase()])));
                      setJudgeInput("");
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => {
                      if (!judgeInput.trim()) return;
                      setJudges((prev) => Array.from(new Set([...prev, judgeInput.trim().toLowerCase()])));
                      setJudgeInput("");
                    }}
                    className="btn"
                  >
                    Add
                  </button>
                </div>
                <span className="text-small leading-[1.5] text-muted">
                  The judge role is granted when the draft is created, and only for accounts that already exist here.
                </span>
              </div>
              <div className="mt-4 flex flex-wrap gap-[7px]">
                {judges.map((j) => (
                  <span key={j} className="chip inline-flex items-center gap-2">
                    {j}
                    <button
                      type="button"
                      aria-label="Remove judge"
                      className="leading-none text-muted"
                      onClick={() => setJudges((prev) => prev.filter((x) => x !== j))}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>

              <div className="eyebrow mt-[clamp(24px,4vw,32px)]">Eligibility</div>
              <div className="mt-3 flex flex-wrap gap-[7px]">
                {ELIGIBILITY.map((e) => (
                  <button key={e} type="button" onClick={() => setEligibility(e)} className="pill" style={chipStyle(eligibility === e, "teal")}>
                    {e}
                  </button>
                ))}
              </div>

              <div className="eyebrow mt-[clamp(24px,4vw,32px)]">Visibility</div>
              <div className="mt-3 flex flex-wrap items-center gap-2.5">
                {(["PUBLIC", "UNLISTED", "PRIVATE"] as const).map((v) => (
                  <button key={v} type="button" onClick={() => setVisibility(v)} className="pill" style={chipStyle(visibility === v, "blue")}>
                    {v === "PUBLIC" ? "Public" : v === "UNLISTED" ? "Link only" : "Private"}
                  </button>
                ))}
                <span className="text-small leading-[1.5] text-muted">
                  Public events are listed. Link only events are hidden from the list but open for anyone with the link. Private events are invisible to anyone without a role: the API returns 404, not 403.
                </span>
              </div>
            </div>
          ) : null}

          {step === 5 ? (
            <div className="card mt-[18px] overflow-hidden p-0">
              {[
                { label: "Name", value: name || "Untitled" },
                { label: "Link", value: `/events/${slug}` },
                { label: "Tagline", value: tagline || "None" },
                { label: "Themes", value: themeTags.join(", ") || "None" },
                { label: "Registration closes", value: registrationClosesAt || "Not set" },
                { label: "Submissions open", value: submissionsOpenAt || "Not set" },
                { label: "Deadline", value: submissionDeadline || "Not set" },
                { label: "Judging closes", value: judgingClosesAt || "Not set" },
                { label: "Team size", value: `${teamMin} to ${teamMax}` },
                { label: "Reviews per project", value: String(reviewsPerSubmission) },
                { label: "Tracks", value: tracks.join(", ") || "None" },
                { label: "Prizes", value: prizes.filter((p) => p.title.trim()).map((p) => p.title).join(", ") || "None" },
                { label: "Rubric", value: criteria.map((c) => `${c.label} ${c.weight}%`).join(", ") },
                { label: "Judges", value: judges.join(", ") || "None yet" },
                { label: "Eligibility", value: eligibility },
                { label: "Visibility", value: visibility === "PUBLIC" ? "Public" : visibility === "UNLISTED" ? "Link only" : "Private" },
              ].map((r) => (
                <div key={r.label} className="flex items-baseline justify-between gap-5 border-b border-line px-[18px] py-3">
                  <span className="flex-none font-mono text-label uppercase tracking-stamp text-muted">{r.label}</span>
                  <span className="min-w-0 text-right text-ui">{r.value}</span>
                </div>
              ))}
            </div>
          ) : null}

          {error ? (
            <Notice className="mt-5">{error}</Notice>
          ) : null}

          <div className="mt-[clamp(24px,4vw,34px)] flex flex-wrap items-center gap-3">
            {step > 0 ? (
              <button type="button" onClick={() => setStep((s) => s - 1)} className="btn">
                Back
              </button>
            ) : null}
            {step < STEPS.length - 1 ? (
              <button
                type="button"
                onClick={() => {
                  setTried(true);
                  if (!stepError) {
                    setTried(false);
                    setStep((s) => s + 1);
                  }
                }}
                className="btn-primary disabled:opacity-40"
              >
                Continue
              </button>
            ) : (
              <>
                <button type="button" onClick={() => void submit(false)} disabled={busy} className="btn disabled:opacity-40">
                  {busy ? "Saving..." : "Save as draft"}
                </button>
                <button type="button" onClick={() => void submit(true)} disabled={busy} className="btn-primary disabled:opacity-40">
                  {busy ? "Publishing..." : "Publish event"}
                </button>
              </>
            )}
            <span
              className="ml-auto text-small leading-[1.5]"
              style={{ color: tried && stepError ? "var(--err)" : "var(--mu)" }}
            >
              {tried && stepError ? stepError : "Draft saves as you type, in this browser."}
            </span>
          </div>
        </div>
      </div>
    </main>
  );
}
