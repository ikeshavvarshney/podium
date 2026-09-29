"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ApiError, get, mediaUrl, patch, post, put, uploadImage } from "@/lib/api";
import { BANNER_BOX, LOGO_BOX } from "@/lib/image";
import { slugify, type SlugCheck } from "@/lib/slug";
import { DEFAULT_CRITERIA, DEFAULT_SCALE, clampScale } from "@/lib/rubric";
import { ScalePicker } from "@/components/event/scale-picker";
import { ShareLink } from "@/components/event/share-link";
import { hue } from "@/lib/hues";
import type { FieldRule, QuestionType, RegistrationField } from "@/lib/types";
import { Notice } from "@/components/ui/notice";
import { Field } from "@/components/ui/field";
import { MarkdownEditor } from "@/components/ui/markdown-editor";
import { fromUtcInput } from "@/lib/format";

const STEPS = [
  { label: "Basics", note: "Name it and say what it is for." },
  { label: "Timeline", note: "Plan the rounds and when each one runs." },
  { label: "Tracks & prizes", note: "Group the submissions and reward them." },
  { label: "Registration form", note: "Choose what participants fill in when they register." },
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

interface CustomRound {
  name: string;
  kind: RoundKind;
  opensAt: string;
  closesAt: string;
}

type RoundKind = "PITCH" | "SCORING" | "QUIZ" | "VOTE" | "RESULT";

const ROUND_KINDS: Array<{ id: RoundKind; label: string }> = [
  { id: "PITCH", label: "Pitch" },
  { id: "SCORING", label: "Scoring" },
  { id: "QUIZ", label: "Quiz" },
  { id: "VOTE", label: "Vote" },
  { id: "RESULT", label: "Result" },
];

interface FormQuestion {
  prompt: string;
  type: QuestionType;
  options: string[];
  helpText: string;
  required: boolean;
}

const STANDARD_FIELDS: Array<{ key: RegistrationField; label: string; note: string }> = [
  { key: "org", label: "Organization or university", note: "Saved on the participant's account." },
  { key: "currentRole", label: "Current role", note: "Student, engineer, researcher..." },
  { key: "track", label: "Track", note: "Only asked when the event has tracks." },
  { key: "experience", label: "Hackathon experience", note: "First event, 2-5, or 6 or more." },
  { key: "skills", label: "Skills", note: "Used for teammate matching on the team board." },
];

const DEFAULT_FIELD_RULES: Record<RegistrationField, FieldRule> = {
  org: "optional",
  currentRole: "optional",
  track: "optional",
  experience: "optional",
  skills: "optional",
};

const QUESTION_TYPES: Array<{ id: QuestionType; label: string }> = [
  { id: "SHORT_TEXT", label: "Short answer" },
  { id: "LONG_TEXT", label: "Paragraph" },
  { id: "URL", label: "Link" },
  { id: "SELECT", label: "Single choice (radio)" },
  { id: "MULTI_SELECT", label: "Multiple choice (checkboxes)" },
  { id: "BOOLEAN", label: "Yes or no" },
];

const hasOptions = (t: QuestionType) => t === "SELECT" || t === "MULTI_SELECT";

interface CriterionRow {
  label: string;
  weight: number;
  hint?: string;
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

  const [registrationOpensAt, setRegistrationOpensAt] = useState("");
  const [registrationClosesAt, setRegistrationClosesAt] = useState("");
  const [submissionsOpenAt, setSubmissionsOpenAt] = useState("");
  const [submissionDeadline, setSubmissionDeadline] = useState("");
  const [judgingOpensAt, setJudgingOpensAt] = useState("");
  const [judgingClosesAt, setJudgingClosesAt] = useState("");
  const [customRounds, setCustomRounds] = useState<CustomRound[]>([]);
  const [logoUrl, setLogoUrl] = useState("");
  const [bannerUrl, setBannerUrl] = useState("");
  const [uploading, setUploading] = useState<"" | "logo" | "banner">("");
  const [uploadError, setUploadError] = useState("");
  const [fieldRules, setFieldRules] = useState<Record<RegistrationField, FieldRule>>(DEFAULT_FIELD_RULES);
  const [formQuestions, setFormQuestions] = useState<FormQuestion[]>([]);
  const [teamMin, setTeamMin] = useState(1);
  const [teamMax, setTeamMax] = useState(4);

  const [trackInput, setTrackInput] = useState("");
  const [tracks, setTracks] = useState<string[]>([]);
  const [prizes, setPrizes] = useState<PrizeRow[]>([
    { title: "First place", amount: "" },
    { title: "Runner-up", amount: "" },
  ]);

  const [criteria, setCriteria] = useState<CriterionRow[]>(
    DEFAULT_CRITERIA.map(({ label, weight, hint }) => ({ label, weight, hint })),
  );
  const [scale, setScale] = useState(DEFAULT_SCALE);

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
        setRegistrationOpensAt(d.registrationOpensAt ?? "");
        setRegistrationClosesAt(d.registrationClosesAt ?? "");
        setSubmissionsOpenAt(d.submissionsOpenAt ?? "");
        setSubmissionDeadline(d.submissionDeadline ?? "");
        setJudgingOpensAt(d.judgingOpensAt ?? "");
        setJudgingClosesAt(d.judgingClosesAt ?? "");
        setCustomRounds(d.customRounds ?? []);
        setLogoUrl(d.logoUrl ?? "");
        setBannerUrl(d.bannerUrl ?? "");
        if (d.fieldRules) setFieldRules({ ...DEFAULT_FIELD_RULES, ...d.fieldRules });
        setFormQuestions(d.formQuestions ?? []);
        setTeamMin(d.teamMin ?? 1);
        setTeamMax(d.teamMax ?? 4);
        setTracks(d.tracks ?? []);
        if (d.prizes) setPrizes(d.prizes);
        if (d.criteria) setCriteria(d.criteria);
        if (d.scale) setScale(clampScale(d.scale));
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
          registrationOpensAt, registrationClosesAt, submissionsOpenAt, submissionDeadline, judgingOpensAt,
          judgingClosesAt, customRounds, logoUrl, bannerUrl, fieldRules, formQuestions, teamMin, teamMax, tracks, prizes, criteria, scale, judges, eligibility, visibility,
          reviewsPerSubmission,
        }),
      );
    } catch {
      // Same as above.
    }
  }, [
    restored, name, slug, slugEdited, tagline, description, themeTags, mode, place,
    registrationOpensAt, registrationClosesAt, submissionsOpenAt, submissionDeadline, judgingOpensAt,
    judgingClosesAt, customRounds, logoUrl, bannerUrl, fieldRules, formQuestions, teamMin, teamMax, tracks, prizes, criteria, scale, judges, eligibility, visibility,
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

  function problemFor(i: number): string {
    if (i === 0) {
      if (!name.trim()) return "An event name is required.";
      if (!slug) return "The event needs a link.";
      if (slugCheck === "checking") return "Checking the event link...";
      if (slugCheck && !slugCheck.available) return `Choose another event link: ${slugCheck.reason}`;
      if (!tagline.trim()) return "A tagline is required: it is the line shown in the listing.";
      if (!description.trim()) return "A description is required: say who it is for and what to build.";
      if (mode !== "ONLINE" && !place.trim()) return "A location is required for an in-person or hybrid event.";
      if (uploading) return "Wait for the image to finish uploading.";
      return "";
    }
    if (i === 1) {
      if (!registrationClosesAt) return "The Registration round needs an end, so people know the last day to sign up.";
      if (!submissionDeadline) return "The Submissions round needs an end: the server enforces the deadline.";
      const backwards = [
        { name: "Registration", start: registrationOpensAt, end: registrationClosesAt },
        { name: "Submissions", start: submissionsOpenAt, end: submissionDeadline },
        { name: "Judging", start: judgingOpensAt, end: judgingClosesAt },
        ...customRounds.map((r) => ({ name: r.name.trim() || "A new round", start: r.opensAt, end: r.closesAt })),
      ].find((r) => r.start && r.end && new Date(r.start) >= new Date(r.end));
      if (backwards) return `${backwards.name} must end after it starts.`;
      if (customRounds.some((r) => !r.name.trim())) return "Every added round needs a name.";
      if (teamMin < 1 || teamMax < teamMin) return "Team size must run from at least 1 upwards.";
      return "";
    }
    if (i === 3) {
      if (formQuestions.some((q) => !q.prompt.trim())) return "Every question needs its text.";
      if (formQuestions.some((q) => hasOptions(q.type) && q.options.filter((o) => o.trim()).length < 2)) {
        return "A choice question needs at least two options.";
      }
      return "";
    }
    if (i === 4) {
      if (criteria.some((c) => !c.label.trim())) return "Every criterion needs a name.";
      if (weightSum !== 100) return `Weights total ${weightSum}%. They must total exactly 100%.`;
      return "";
    }
    return "";
  }

  /** The first step before `until` that still has a missing required field. */
  function firstProblem(until: number): { step: number; message: string } | null {
    for (let i = 0; i < until; i++) {
      const message = problemFor(i);
      if (message) return { step: i, message };
    }
    return null;
  }

  const stepError = problemFor(step);

  async function upload(kind: "logo" | "banner", file: File | undefined) {
    if (!file) return;
    setUploading(kind);
    setUploadError("");
    try {
      const { url } = await uploadImage(file, undefined, kind === "logo" ? LOGO_BOX : BANNER_BOX);
      if (kind === "logo") setLogoUrl(url);
      else setBannerUrl(url);
    } catch (err) {
      setUploadError(err instanceof ApiError ? err.message : "That image could not be uploaded.");
    } finally {
      setUploading("");
    }
  }

  function span(start: string, end: string): string {
    if (!start && !end) return "Not set";
    return `${start ? `${start.replace("T", " ")} UTC` : "any time"} to ${end ? `${end.replace("T", " ")} UTC` : "open-ended"}`;
  }

  function iso(value: string): string | undefined {
    return fromUtcInput(value) ?? undefined;
  }

  async function submit(publish: boolean) {
    const blocked = firstProblem(STEPS.length);
    if (blocked) {
      setStep(blocked.step);
      setTried(true);
      return;
    }
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
        logoUrl: logoUrl || null,
        bannerUrl: bannerUrl || null,
        registrationFields: fieldRules,
        registrationOpensAt: iso(registrationOpensAt),
        registrationClosesAt: iso(registrationClosesAt),
        submissionsOpenAt: iso(submissionsOpenAt),
        submissionDeadline: iso(submissionDeadline),
        judgingOpensAt: iso(judgingOpensAt),
        judgingClosesAt: iso(judgingClosesAt),
      });

      for (const [position, q] of formQuestions.entries()) {
        await post(`/events/${event.slug}/questions`, {
          stage: "REGISTRATION",
          prompt: q.prompt.trim(),
          type: q.type,
          options: hasOptions(q.type) ? q.options.map((o) => o.trim()).filter(Boolean) : [],
          helpText: q.helpText.trim() || null,
          required: q.required,
          publicAnswer: false,
          position,
        });
      }

      for (const round of customRounds) {
        await post(`/events/${event.slug}/rounds`, {
          name: round.name.trim(),
          kind: round.kind,
          opensAt: iso(round.opensAt) ?? null,
          closesAt: iso(round.closesAt) ?? null,
        });
      }

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
          hint: c.hint?.trim() || null,
          weight: Math.round(c.weight),
          minScore: 1,
          maxScore: scale,
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
        Seven steps. Fields marked required must be filled before the event can be created.
      </p>

      <div className="mt-[clamp(26px,4vw,38px)] flex flex-wrap items-start gap-[clamp(24px,4vw,46px)]">
        <aside className="grid min-w-[180px] max-w-[240px] flex-[1_1_190px] gap-1">
          {STEPS.map((s, i) => {
            const on = step === i;
            return (
              <button
                key={s.label}
                type="button"
                onClick={() => {
                  const blocked = i > step ? firstProblem(i) : null;
                  setTried(Boolean(blocked));
                  setStep(blocked ? blocked.step : i);
                }}
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
              <Field label="Tagline (required)" hint="Under 90 characters reads best in the listing." bordered>
                <input className={FIELD} value={tagline} onChange={(e) => setTagline(e.target.value)} placeholder="One line on what participants will build" />
              </Field>
              <div className="border-b border-line py-4">
                <MarkdownEditor
                  id="event-description"
                  label="Description (required)"
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
                <Field label="Location (required)" hint="Venue or city, so people know where to go." bordered>
                  <input className={FIELD} value={place} onChange={(e) => setPlace(e.target.value)} placeholder="Rotterdam + online" />
                </Field>
              ) : null}
              <div className="grid gap-[7px] border-b border-line py-4">
                <label className="text-ui font-medium">Logo and banner</label>
                <p className="m-0 text-small leading-[1.5] text-muted">
                  Optional. PNG, JPEG, GIF or WebP. A square logo shows on event cards; a wide banner (about 3:1, for
                  example 1500 x 500) sits at the top of the event page.
                </p>
                <div className="mt-1 flex flex-wrap gap-3">
                  {(
                    [
                      { kind: "logo", label: "Square logo", url: logoUrl, clear: () => setLogoUrl(""), box: "h-[112px] w-[112px]" },
                      { kind: "banner", label: "Banner", url: bannerUrl, clear: () => setBannerUrl(""), box: "h-[112px] w-[336px] max-w-full" },
                    ] as const
                  ).map((img) => (
                    <div key={img.kind} className="grid gap-1.5">
                      <label
                        className={`${img.box} grid cursor-pointer place-items-center overflow-hidden rounded-[10px] border border-dashed border-line-strong bg-elevated text-center text-small text-muted hover:border-muted`}
                      >
                        {img.url ? (
                          <img src={mediaUrl(img.url)} alt={`${img.label} preview`} className="h-full w-full object-cover" />
                        ) : (
                          <span className="px-2">{uploading === img.kind ? "Uploading..." : `+ ${img.label}`}</span>
                        )}
                        <input
                          type="file"
                          accept="image/png,image/jpeg,image/gif,image/webp"
                          className="sr-only"
                          onChange={(e) => {
                            void upload(img.kind, e.target.files?.[0]);
                            e.target.value = "";
                          }}
                        />
                      </label>
                      {img.url ? (
                        <button type="button" onClick={img.clear} className="justify-self-start border-0 bg-transparent p-0 text-small text-muted underline">
                          Remove {img.label.toLowerCase()}
                        </button>
                      ) : null}
                    </div>
                  ))}
                </div>
                {uploadError ? <p className="m-0 text-small text-danger">{uploadError}</p> : null}
              </div>
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
              <div className="grid gap-3">
                {[
                  {
                    name: "Registration",
                    hint: "People sign up and form teams.",
                    start: { value: registrationOpensAt, set: setRegistrationOpensAt },
                    end: { value: registrationClosesAt, set: setRegistrationClosesAt },
                    endRequired: true,
                  },
                  {
                    name: "Submissions",
                    hint: "Teams hand in their projects. The end is the deadline.",
                    start: { value: submissionsOpenAt, set: setSubmissionsOpenAt },
                    end: { value: submissionDeadline, set: setSubmissionDeadline },
                    endRequired: true,
                  },
                  {
                    name: "Judging",
                    hint: "Judges score the projects assigned to them.",
                    start: { value: judgingOpensAt, set: setJudgingOpensAt },
                    end: { value: judgingClosesAt, set: setJudgingClosesAt },
                    endRequired: false,
                  },
                ].map((r, i) => (
                  <div key={r.name} className="card p-[clamp(14px,2vw,18px)]">
                    <div className="flex flex-wrap items-baseline gap-2.5">
                      <span className="font-mono text-ui text-muted">{String(i + 1).padStart(2, "0")}</span>
                      <h3 className="text-ui font-semibold">{r.name}</h3>
                      <span className="ml-auto font-mono text-label uppercase tracking-stamp text-muted">
                        default · enforced
                      </span>
                    </div>
                    <p className="mt-1 text-small leading-[1.5] text-muted">{r.hint}</p>
                    <div className="mt-3 grid gap-2.5 sm:grid-cols-2">
                      <label className="grid gap-1.5 text-small text-muted">
                        Starts, UTC (optional)
                        <input
                          type="datetime-local"
                          className={`${FIELD} font-mono text-small`}
                          value={r.start.value}
                          onChange={(e) => r.start.set(e.target.value)}
                        />
                      </label>
                      <label className="grid gap-1.5 text-small text-muted">
                        Ends, UTC {r.endRequired ? "(required)" : "(optional)"}
                        <input
                          type="datetime-local"
                          className={`${FIELD} font-mono text-small`}
                          value={r.end.value}
                          onChange={(e) => r.end.set(e.target.value)}
                        />
                      </label>
                    </div>
                  </div>
                ))}

                {customRounds.map((r, i) => {
                  const update = (change: Partial<CustomRound>) =>
                    setCustomRounds((prev) => prev.map((x, j) => (j === i ? { ...x, ...change } : x)));
                  return (
                    <div key={i} className="card p-[clamp(14px,2vw,18px)]">
                      <div className="flex flex-wrap items-center gap-2.5">
                        <span className="font-mono text-ui text-muted">{String(i + 4).padStart(2, "0")}</span>
                        <input
                          className={`${FIELD} min-w-0 flex-[1_1_200px]`}
                          placeholder="Round name, e.g. Final pitches"
                          aria-label="Round name"
                          value={r.name}
                          onChange={(e) => update({ name: e.target.value })}
                        />
                        <select
                          className={`${FIELD} flex-none`}
                          aria-label="Round type"
                          value={r.kind}
                          onChange={(e) => update({ kind: e.target.value as RoundKind })}
                        >
                          {ROUND_KINDS.map((k) => (
                            <option key={k.id} value={k.id}>
                              {k.label}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          aria-label={`Delete ${r.name || "this round"}`}
                          onClick={() => setCustomRounds((prev) => prev.filter((_, j) => j !== i))}
                          className="h-[34px] w-[34px] flex-none rounded-md border border-line bg-surface text-body text-muted hover:border-danger hover:text-danger"
                        >
                          ×
                        </button>
                      </div>
                      <p className="mt-1.5 text-small leading-[1.5] text-muted">
                        Shown on the event&apos;s round ladder. Only the three default rounds are enforced by the server.
                      </p>
                      <div className="mt-3 grid gap-2.5 sm:grid-cols-2">
                        <label className="grid gap-1.5 text-small text-muted">
                          Starts, UTC (optional)
                          <input
                            type="datetime-local"
                            className={`${FIELD} font-mono text-small`}
                            value={r.opensAt}
                            onChange={(e) => update({ opensAt: e.target.value })}
                          />
                        </label>
                        <label className="grid gap-1.5 text-small text-muted">
                          Ends, UTC (optional)
                          <input
                            type="datetime-local"
                            className={`${FIELD} font-mono text-small`}
                            value={r.closesAt}
                            onChange={(e) => update({ closesAt: e.target.value })}
                          />
                        </label>
                      </div>
                    </div>
                  );
                })}
              </div>
              <button
                type="button"
                onClick={() => setCustomRounds((prev) => [...prev, { name: "", kind: "PITCH", opensAt: "", closesAt: "" }])}
                className="mt-3.5 rounded-[10px] border border-dashed border-line px-3.5 py-[9px] text-small hover:border-muted"
              >
                + Add a round
              </button>
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
                    aria-label="Prize amount in USD"
                    placeholder="USD"
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
                Amounts are per prize, in US dollars (USD). Leave blank for a non-cash prize.
              </p>
            </div>
          ) : null}

          {step === 3 ? (
            <div className="mt-3">
              <div className="eyebrow mt-2">Standard fields</div>
              <p className="mt-2 text-small leading-[1.5] text-muted">
                Every registration asks for these unless you turn one off. The server checks the ones you make required.
              </p>
              <div className="mt-2 grid">
                {[
                  { label: "Full name", note: "Always asked." },
                  { label: "Email", note: "Taken from the account." },
                ].map((f) => (
                  <div key={f.label} className="flex flex-wrap items-center gap-3 border-b border-line py-3">
                    <div className="min-w-0 flex-[1_1_220px]">
                      <div className="text-ui">{f.label}</div>
                      <div className="text-small leading-[1.5] text-muted">{f.note}</div>
                    </div>
                    <span className="font-mono text-label uppercase tracking-stamp text-muted">required</span>
                  </div>
                ))}
                {STANDARD_FIELDS.map((f) => (
                  <div key={f.key} className="flex flex-wrap items-center gap-3 border-b border-line py-3">
                    <div className="min-w-0 flex-[1_1_220px]">
                      <div className="text-ui">{f.label}</div>
                      <div className="text-small leading-[1.5] text-muted">{f.note}</div>
                    </div>
                    <div role="radiogroup" aria-label={f.label} className="flex flex-none gap-1.5">
                      {(["required", "optional", "off"] as const).map((rule) => (
                        <button
                          key={rule}
                          type="button"
                          role="radio"
                          aria-checked={fieldRules[f.key] === rule}
                          onClick={() => setFieldRules((prev) => ({ ...prev, [f.key]: rule }))}
                          className="pill btn-sm capitalize"
                          style={chipStyle(fieldRules[f.key] === rule)}
                        >
                          {rule}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
                <div className="flex flex-wrap items-center gap-3 border-b border-line py-3">
                  <div className="min-w-0 flex-[1_1_220px]">
                    <div className="text-ui">Rules and code of conduct</div>
                    <div className="text-small leading-[1.5] text-muted">Every participant accepts both.</div>
                  </div>
                  <span className="font-mono text-label uppercase tracking-stamp text-muted">required</span>
                </div>
              </div>

              <div className="eyebrow mt-[clamp(26px,4vw,34px)]">Your questions</div>
              <p className="mt-2 text-small leading-[1.5] text-muted">
                Add anything else you need to know. Answers are visible to you and your admins only.
              </p>
              <div className="mt-3 grid gap-3">
                {formQuestions.map((q, i) => {
                  const update = (change: Partial<FormQuestion>) =>
                    setFormQuestions((prev) => prev.map((x, j) => (j === i ? { ...x, ...change } : x)));
                  const move = (to: number) =>
                    setFormQuestions((prev) => {
                      const next = [...prev];
                      const [item] = next.splice(i, 1);
                      next.splice(to, 0, item!);
                      return next;
                    });
                  return (
                    <div key={i} className="card p-[clamp(14px,2vw,18px)]">
                      <div className="flex flex-wrap items-center gap-2.5">
                        <span className="font-mono text-ui text-muted">Q{i + 1}</span>
                        <input
                          className={`${FIELD} min-w-0 flex-[1_1_240px]`}
                          placeholder="Question, e.g. What do you want to build?"
                          aria-label={`Question ${i + 1}`}
                          value={q.prompt}
                          onChange={(e) => update({ prompt: e.target.value })}
                        />
                        <select
                          className={`${FIELD} flex-none`}
                          aria-label="Answer type"
                          value={q.type}
                          onChange={(e) => {
                            const type = e.target.value as QuestionType;
                            update({ type, options: hasOptions(type) && q.options.length === 0 ? ["", ""] : q.options });
                          }}
                        >
                          {QUESTION_TYPES.map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.label}
                            </option>
                          ))}
                        </select>
                      </div>
                      <input
                        className={`${FIELD} mt-2.5 w-full text-small`}
                        placeholder="Help text (optional)"
                        aria-label="Help text"
                        value={q.helpText}
                        onChange={(e) => update({ helpText: e.target.value })}
                      />
                      {hasOptions(q.type) ? (
                        <div className="mt-2.5 grid gap-2">
                          {q.options.map((o, k) => (
                            <div key={k} className="flex items-center gap-2">
                              <span aria-hidden="true" className="w-4 text-center text-muted">
                                {q.type === "SELECT" ? "○" : "☐"}
                              </span>
                              <input
                                className={`${FIELD} min-w-0 flex-1 text-small`}
                                placeholder={`Option ${k + 1}`}
                                aria-label={`Option ${k + 1}`}
                                value={o}
                                onChange={(e) => update({ options: q.options.map((x, m) => (m === k ? e.target.value : x)) })}
                              />
                              <button
                                type="button"
                                aria-label={`Remove option ${k + 1}`}
                                onClick={() => update({ options: q.options.filter((_, m) => m !== k) })}
                                className="h-[34px] w-[34px] flex-none rounded-md border border-line bg-surface text-body text-muted hover:border-danger hover:text-danger"
                              >
                                ×
                              </button>
                            </div>
                          ))}
                          <button
                            type="button"
                            onClick={() => update({ options: [...q.options, ""] })}
                            className="justify-self-start border-0 bg-transparent p-0 text-small text-muted underline"
                          >
                            + Add option
                          </button>
                        </div>
                      ) : null}
                      <div className="mt-3 flex flex-wrap items-center gap-2.5 border-t border-line pt-3">
                        <label className="flex cursor-pointer items-center gap-2 text-small">
                          <input
                            type="checkbox"
                            checked={q.required}
                            onChange={(e) => update({ required: e.target.checked })}
                            className="h-[16px] w-[16px] accent-action"
                          />
                          Required
                        </label>
                        <span className="ml-auto flex gap-1.5">
                          <button type="button" disabled={i === 0} onClick={() => move(i - 1)} className="btn btn-sm disabled:opacity-40" aria-label="Move up">
                            ↑
                          </button>
                          <button
                            type="button"
                            disabled={i === formQuestions.length - 1}
                            onClick={() => move(i + 1)}
                            className="btn btn-sm disabled:opacity-40"
                            aria-label="Move down"
                          >
                            ↓
                          </button>
                          <button
                            type="button"
                            onClick={() => setFormQuestions((prev) => prev.filter((_, j) => j !== i))}
                            className="btn btn-sm hover:border-danger hover:text-danger"
                          >
                            Delete
                          </button>
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
              <button
                type="button"
                onClick={() =>
                  setFormQuestions((prev) => [...prev, { prompt: "", type: "SHORT_TEXT", options: [], helpText: "", required: false }])
                }
                className="mt-3.5 rounded-[10px] border border-dashed border-line px-3.5 py-[9px] text-small hover:border-muted"
              >
                + Add a question
              </button>
            </div>
          ) : null}

          {step === 4 ? (
            <div className="mt-3">
              <div className="border-b border-line py-4">
                <ScalePicker value={scale} onChange={setScale} />
              </div>
              {criteria.map((c, i) => (
                <div key={i} className="flex flex-wrap items-center gap-3 border-b border-line py-[13px]">
                  <input
                    aria-label="Criterion"
                    className={`${FIELD} min-w-0 flex-[1_1_180px]`}
                    value={c.label}
                    onChange={(e) =>
                      // A renamed criterion no longer matches its default guidance for judges.
                      setCriteria((prev) => prev.map((x, j) => (j === i ? { label: e.target.value, weight: x.weight } : x)))
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
                  Weights must total 100; they turn each ballot into one number.
                </span>
                <span className="font-mono text-ui" style={{ color: weightSum === 100 ? "var(--ac)" : "var(--err)" }}>
                  {weightSum}
                </span>
              </div>
            </div>
          ) : null}

          {step === 5 ? (
            <div className="mt-3">
              <Field label="Judges per project" hint="How many judges score each project. More judges means fairer results but more work for each judge; 2 to 3 is typical. Auto-balance fills to this number, and you can still assign more or fewer by hand." bordered>
                <input
                  type="number"
                  min={1}
                  max={20}
                  className={`${FIELD} w-[82px] font-mono text-small`}
                  value={reviewsPerSubmission}
                  onChange={(e) => setReviewsPerSubmission(Number(e.target.value))}
                />
              </Field>
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

          {step === 6 ? (
            <div className="card mt-[18px] overflow-hidden p-0">
              {[
                { label: "Name", value: name || "Untitled" },
                { label: "Link", value: `/events/${slug}` },
                { label: "Tagline", value: tagline || "None" },
                { label: "Themes", value: themeTags.join(", ") || "None" },
                { label: "Logo", value: logoUrl ? "Uploaded" : "None" },
                { label: "Banner", value: bannerUrl ? "Uploaded" : "None" },
                { label: "Registration", value: span(registrationOpensAt, registrationClosesAt) },
                { label: "Submissions", value: span(submissionsOpenAt, submissionDeadline) },
                { label: "Judging", value: span(judgingOpensAt, judgingClosesAt) },
                ...customRounds.map((r, i) => ({
                  label: `Round ${i + 4}`,
                  value: `${r.name.trim() || "Unnamed"}: ${span(r.opensAt, r.closesAt)}`,
                })),
                { label: "Team size", value: `${teamMin} to ${teamMax}` },
                { label: "Judges per project", value: String(reviewsPerSubmission) },
                { label: "Tracks", value: tracks.join(", ") || "None" },
                { label: "Prizes", value: prizes.filter((p) => p.title.trim()).map((p) => p.title).join(", ") || "None" },
                { label: "Rubric", value: `${criteria.map((c) => `${c.label} ${c.weight}%`).join(", ")}, scored out of ${scale}` },
                {
                  label: "Registration form",
                  value: `${STANDARD_FIELDS.filter((f) => fieldRules[f.key] === "required").length} required and ${
                    STANDARD_FIELDS.filter((f) => fieldRules[f.key] === "optional").length
                  } optional standard fields, ${formQuestions.length} question${formQuestions.length === 1 ? "" : "s"}`,
                },
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
