"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ScreenSkeleton } from "@/components/layout/screen-skeleton";
import { useSession } from "@/components/providers/session-provider";
import { ApiError, get, patch, post } from "@/lib/api";
import { coverHue, hue } from "@/lib/hues";
import type { CustomQuestion, EventDetail, FieldRule, RegistrationField, Team } from "@/lib/types";
import { Notice } from "@/components/ui/notice";
import { Field } from "@/components/ui/field";
import { utcDateTime } from "@/lib/format";

const FIELD =
  "w-full bg-surface border border-line-strong rounded-[10px] px-[13px] py-2.5 text-ui text-text outline-none focus:border-muted [transition:border-color_200ms]";

const EXPERIENCE = [
  { id: "FIRST_EVENT", label: "First event" },
  { id: "A_FEW", label: "2-5 events" },
  { id: "MANY", label: "6 or more" },
] as const;

const SKILLS = ["Backend", "Frontend", "ML", "Data", "Design", "Product", "Security", "Infra", "Mobile", "Research"];

const MODE_LABEL: Record<string, string> = { ONLINE: "Online", IN_PERSON: "In-person", HYBRID: "Hybrid" };

function chipStyle(on: boolean) {
  // A chosen option is always the brand tone.
  const h = hue("brand");
  return on ? { background: h.bg, color: h.fg, borderColor: "transparent" } : undefined;
}

export default function RegisterPage() {
  const params = useParams<{ slug: string }>();
  const slug = params.slug;
  const { user, loading: sessionLoading, refresh } = useSession();

  const [event, setEvent] = useState<EventDetail | null>(null);
  const [questions, setQuestions] = useState<CustomQuestion[]>([]);
  const [team, setTeam] = useState<Team | null>(null);
  const [error, setError] = useState("");
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [inviteUrl, setInviteUrl] = useState("");
  const [inviteFailed, setInviteFailed] = useState(false);
  const [copied, setCopied] = useState(false);

  const [name, setName] = useState("");
  const [org, setOrg] = useState("");
  const [currentRole, setCurrentRole] = useState("");
  const [trackId, setTrackId] = useState("");
  const [entryType, setEntryType] = useState<"team" | "solo">("team");
  const [teamName, setTeamName] = useState("");
  const [experience, setExperience] = useState<string>("");
  const [skills, setSkills] = useState<string[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [acceptRules, setAcceptRules] = useState(false);
  const [acceptConduct, setAcceptConduct] = useState(false);
  const [shareProfile, setShareProfile] = useState(false);

  const load = useCallback(async () => {
    try {
      const [detail, list] = await Promise.all([
        get<EventDetail>(`/events/${slug}`),
        get<CustomQuestion[]>(`/events/${slug}/questions`).catch(() => []),
      ]);
      setEvent(detail);
      setQuestions(list.filter((q) => q.stage === "REGISTRATION"));
      if (detail.viewer.isParticipant) {
        setDone(true);
        setTeam(await get<Team | null>(`/events/${slug}/teams/mine`).catch(() => null));
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "This event could not be loaded.");
    }
  }, [slug]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!user) return;
    setName(user.name);
    setOrg(user.org ?? "");
  }, [user]);

  const rules: Record<RegistrationField, FieldRule> = {
    org: "optional",
    currentRole: "optional",
    track: "optional",
    experience: "optional",
    skills: "optional",
    ...(event?.registrationFields ?? {}),
  };
  const asks = (f: RegistrationField) => rules[f] !== "off";
  const tag = (f: RegistrationField) => (rules[f] === "required" ? " (required)" : "");

  const missing: Record<string, string> = {};
  if (!name.trim()) missing.name = "Your name is required.";
  if (rules.org === "required" && !org.trim()) missing.org = "This event asks for your organization or university.";
  if (rules.currentRole === "required" && !currentRole.trim()) missing.role = "This event asks for your current role.";
  if (rules.track === "required" && (event?.tracks.length ?? 0) > 0 && !trackId) missing.track = "Choose a track.";
  if (rules.experience === "required" && !experience) missing.experience = "Choose your experience.";
  if (rules.skills === "required" && skills.length === 0) missing.skills = "Pick at least one skill.";
  if (entryType === "team" && !teamName.trim()) missing.team = "Name the team, or enter solo.";
  for (const q of questions) {
    if (q.required && !answers[q.id]?.trim()) missing[q.id] = "This question is required.";
  }
  if (!acceptRules) missing.rules = "Confirm the rules to register.";
  if (!acceptConduct) missing.conduct = "Accept the code of conduct to register.";
  const show = (key: string) => (tried ? missing[key] : undefined);

  async function submit() {
    setTried(true);
    if (!event || Object.keys(missing).length > 0) return;
    setBusy(true);
    setError("");
    try {
      if (name.trim() !== user?.name || org.trim() !== (user?.org ?? "")) {
        await patch("/auth/me", { name: name.trim(), org: org.trim() || null });
      }

      await post(`/events/${slug}/register`, {
        currentRole: currentRole.trim() || null,
        experience: experience || null,
        skills,
        trackId: trackId || null,
        shareProfile,
        acceptRules,
        acceptConduct,
        answers: Object.entries(answers)
          .filter(([, value]) => value.trim())
          .map(([questionId, value]) => ({ questionId, value })),
      });

      if (entryType === "team") {
        const created = await post<Team>(`/events/${slug}/teams`, {
          name: teamName.trim(),
          lookingForMembers: true,
        });
        setTeam(created);
        const invite = await post<{ url: string }>(`/events/${slug}/teams/${created.id}/invites`, {
          maxUses: Math.max(1, event.maxTeamSize - 1),
        }).catch(() => null);
        setInviteUrl(invite?.url ?? "");
        setInviteFailed(!invite);
      } else {
        // A solo entry is a team of one, so it can submit right away and still grow later through an invite.
        const created = await post<Team>(`/events/${slug}/teams`, {
          name: `${name.trim()} (solo)`,
          lookingForMembers: false,
        });
        setTeam(created);
      }

      await refresh();
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Registration could not be completed.");
    } finally {
      setBusy(false);
    }
  }

  if (sessionLoading || (!event && !error)) {
    return (
      <main className="screen max-w-[980px] pt-[clamp(26px,4vw,40px)]">
        <ScreenSkeleton rows={4} />
      </main>
    );
  }

  if (!event) {
    return (
      <main className="screen max-w-[980px] pt-[clamp(26px,4vw,40px)]">
        <div className="eyebrow">Registration</div>
        <h1 className="display mt-3.5 text-page">{error}</h1>
        <Link href="/events" className="btn mt-8 inline-flex">
          Browse events
        </Link>
      </main>
    );
  }

  const cover = hue(coverHue(event.name));
  const fmt = (iso: string | null) =>
    iso ? utcDateTime(iso) : null;
  const eventWindow = [fmt(event.submissionsOpenAt), fmt(event.submissionDeadline)].filter(Boolean).join(" to ");
  const closed = Boolean(event.registrationClosesAt && new Date(event.registrationClosesAt).getTime() < Date.now());
  const mode = MODE_LABEL[event.mode ?? "HYBRID"];

  return (
    <main className="screen max-w-[980px] pb-[120px] pt-[clamp(26px,4vw,40px)]">
      <div className="flex flex-wrap items-center gap-4 border-b border-line pb-[clamp(20px,3vw,28px)]">
        <div
          className="grid h-[54px] w-[54px] flex-none place-items-center rounded-[11px] font-mono text-heading"
          style={{ background: cover.bg, color: cover.fg }}
        >
          {event.name.charAt(0).toUpperCase()}
        </div>
        <div className="min-w-0 flex-[1_1_240px]">
          <div className="eyebrow">Registration · {event.owner.org ?? event.owner.name}</div>
          <h1 className="mt-2.5 font-display text-console font-[560] leading-[1.08] tracking-[-0.035em]">
            {event.name}
          </h1>
          <div className="mt-2 font-mono text-meta text-muted">
            {[eventWindow, mode, event.place].filter(Boolean).join(" · ")}
          </div>
        </div>
      </div>

      {!user ? (
        <div className="mt-[clamp(24px,4vw,36px)]">
          <h2 className="display text-page">Sign in to register.</h2>
          <p className="mt-4 max-w-[56ch] text-body leading-[1.65] text-muted">
            Registration creates an event membership on your account, so we need to know who you
            are first.
          </p>
          <div className="mt-6 flex flex-wrap gap-2.5">
            <Link href={`/auth?next=/events/${slug}/register`} className="btn-primary">
              Sign in
            </Link>
            <Link href={`/events/${slug}`} className="btn">
              Back to the event
            </Link>
          </div>
        </div>
      ) : done ? (
        <div
          className="card mt-[clamp(24px,4vw,36px)] p-[clamp(24px,4vw,40px)]"
          style={{ animation: "pop 420ms cubic-bezier(0.16,1,0.3,1) both" }}
        >
          <h2 className="display text-page">You are registered for {event.name}.</h2>
          <p className="mt-4 max-w-[56ch] text-body leading-[1.65] text-muted">
            {team ? `Entering as ${team.name}.` : "Entering solo."} Your entry stays editable
            until the submission deadline, which the server enforces.
          </p>
          {inviteUrl ? (
            <div className="mt-5">
              <div className="eyebrow">Invite link for your teammates</div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <code className="select-all break-all rounded-md border border-line bg-elevated px-2.5 py-2 font-mono text-meta text-muted">
                  {inviteUrl}
                </code>
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => {
                    void navigator.clipboard?.writeText(inviteUrl).then(() => setCopied(true)).catch(() => undefined);
                  }}
                >
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
              <p className="mt-2 max-w-[56ch] text-small leading-[1.5] text-muted">
                podium sends no email, so share this yourself. It is shown only now.
              </p>
            </div>
          ) : inviteFailed ? (
            <Notice className="mt-5">
              Your team was created, but its invite link could not be. Open your team page to make one.
            </Notice>
          ) : null}
          <div className="mt-6 flex flex-wrap gap-2.5">
            <Link href={`/events/${slug}/submit`} className="btn-primary">
              Start my submission
            </Link>
            <Link href="/events" className="btn">
              Browse other events
            </Link>
          </div>
        </div>
      ) : closed ? (
        <div className="mt-[clamp(24px,4vw,36px)]">
          <h2 className="display text-page">Registration is closed.</h2>
          <p className="mt-4 max-w-[56ch] text-body leading-[1.65] text-muted">
            Registration closed on {fmt(event.registrationClosesAt)}, and the server refuses late
            registrations. Ask the organizer if you think this is a mistake.
          </p>
          <div className="mt-6 flex flex-wrap gap-2.5">
            <Link href={`/events/${slug}`} className="btn-primary">
              Back to the event
            </Link>
          </div>
        </div>
      ) : (
        <>
          <p className="mt-[22px] max-w-[62ch] text-body leading-[1.65] text-muted">
            {event.eligibility ? `Eligibility: ${event.eligibility}. ` : ""}Teams of {event.minTeamSize} to{" "}
            {event.maxTeamSize}.
          </p>

          <div className="eyebrow mt-[clamp(26px,4vw,34px)]">Your details</div>
          {[
            { key: "name", label: "Full name", value: name, set: setName, placeholder: "", readOnly: false, ac: "name" },
            { key: "email", label: "Email", value: user.email, set: () => undefined, placeholder: "", readOnly: true, ac: "email" },
            ...(asks("org")
              ? [{ key: "org", label: `Organization or university${tag("org")}`, value: org, set: setOrg, placeholder: "", readOnly: false, ac: "organization" }]
              : []),
            ...(asks("currentRole")
              ? [{ key: "role", label: `Current role${tag("currentRole")}`, value: currentRole, set: setCurrentRole, placeholder: "Student, engineer, researcher...", readOnly: false, ac: "organization-title" }]
              : []),
          ].map((f) => (
            <Field key={f.key} label={f.label} error={show(f.key)} bordered>
              <input
                className={`${FIELD} ${f.readOnly ? "text-muted" : ""}`}
                value={f.value}
                readOnly={f.readOnly}
                autoComplete={f.ac}
                placeholder={f.placeholder}
                onChange={(e) => f.set(e.target.value)}
                style={show(f.key) ? { borderColor: "var(--err)" } : undefined}
              />
            </Field>
          ))}

          {event.tracks.length > 0 && asks("track") ? (
            <>
              <div className="eyebrow mt-[clamp(26px,4vw,34px)]">Track{tag("track")}</div>
              <div role="group" aria-label="Track" className="mt-3 flex flex-wrap gap-[7px]">
                {event.tracks.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setTrackId(trackId === t.id ? "" : t.id)}
                    aria-pressed={trackId === t.id} className="pill active:scale-95"
                    style={chipStyle(trackId === t.id)}
                  >
                    {t.name}
                  </button>
                ))}
              </div>
              {show("track") ? <p className="mt-1.5 text-small text-danger">{show("track")}</p> : null}
            </>
          ) : null}

          <div className="eyebrow mt-[clamp(26px,4vw,34px)]">How you are entering</div>
          <div role="group" aria-label="How you are entering" className="mt-3 flex flex-wrap gap-[7px]">
            {(["team", "solo"] as const).map((o) => (
              <button key={o} type="button" onClick={() => setEntryType(o)} aria-pressed={entryType === o} className="pill active:scale-95" style={chipStyle(entryType === o)}>
                {o === "team" ? "Team" : "Solo"}
              </button>
            ))}
          </div>

          {entryType === "team" ? (
            <Field
              label="Team name"
              hint={`Up to ${event.maxTeamSize - 1} teammates join with an invite link you get once you register.`}
              error={show("team")}
              bordered
            >
              <input
                className={FIELD}
                value={teamName}
                onChange={(e) => setTeamName(e.target.value)}
                placeholder="Sievebox"
                style={show("team") ? { borderColor: "var(--err)" } : undefined}
              />
            </Field>
          ) : null}

          {asks("experience") ? (
            <>
          <div className="eyebrow mt-[clamp(26px,4vw,34px)]">Experience{tag("experience")}</div>
          <div role="group" aria-label="Experience" className="mt-3 flex flex-wrap gap-[7px]">
            {EXPERIENCE.map((x) => (
              <button key={x.id} type="button" onClick={() => setExperience(experience === x.id ? "" : x.id)} aria-pressed={experience === x.id} className="pill active:scale-95" style={chipStyle(experience === x.id)}>
                {x.label}
              </button>
            ))}
          </div>
          {show("experience") ? <p className="mt-1.5 text-small text-danger">{show("experience")}</p> : null}
            </>
          ) : null}

          {asks("skills") ? (
            <>
          <div className="eyebrow mt-[clamp(26px,4vw,34px)]">Skills{tag("skills")}</div>
          <p className="mt-2 text-small leading-[1.5] text-muted">
            Used for teammate matching on the board.{rules.skills === "required" ? "" : " Optional."}
          </p>
          <div role="group" aria-label="Skills" className="mt-3 flex flex-wrap gap-[7px]">
            {SKILLS.map((skill) => {
              const on = skills.includes(skill);
              return (
                <button
                  key={skill}
                  type="button"
                  onClick={() => setSkills((prev) => (on ? prev.filter((s) => s !== skill) : [...prev, skill]))}
                  aria-pressed={on} className="pill active:scale-95"
                  style={chipStyle(on)}
                >
                  {skill}
                </button>
              );
            })}
          </div>
          {show("skills") ? <p className="mt-1.5 text-small text-danger">{show("skills")}</p> : null}
            </>
          ) : null}

          {questions.length > 0 ? (
            <>
              <div className="eyebrow mt-[clamp(26px,4vw,34px)]">Questions from the organizer</div>
              {questions.map((q) => {
                const value = answers[q.id] ?? "";
                const set = (v: string) => setAnswers((prev) => ({ ...prev, [q.id]: v }));
                const picked = value ? value.split("\n") : [];
                const border = show(q.id) ? { borderColor: "var(--err)" } : undefined;
                return (
                  <Field key={q.id} label={q.required ? `${q.prompt} (required)` : q.prompt} hint={q.helpText ?? undefined} error={show(q.id)} bordered>
                    {q.type === "SELECT" || q.type === "BOOLEAN" ? (
                      <div role="radiogroup" aria-label={q.prompt} className="grid gap-2">
                        {(q.type === "BOOLEAN" ? ["Yes", "No"] : q.options ?? []).map((o) => (
                          <label key={o} className="flex cursor-pointer items-center gap-2.5 text-ui">
                            <input type="radio" name={q.id} checked={value === o} onChange={() => set(o)} className="h-[16px] w-[16px] accent-action" />
                            {o}
                          </label>
                        ))}
                      </div>
                    ) : q.type === "MULTI_SELECT" ? (
                      <div role="group" aria-label={q.prompt} className="grid gap-2">
                        {(q.options ?? []).map((o) => (
                          <label key={o} className="flex cursor-pointer items-center gap-2.5 text-ui">
                            <input
                              type="checkbox"
                              checked={picked.includes(o)}
                              onChange={(e) => set((e.target.checked ? [...picked, o] : picked.filter((x) => x !== o)).join("\n"))}
                              className="h-[16px] w-[16px] accent-action"
                            />
                            {o}
                          </label>
                        ))}
                      </div>
                    ) : q.type === "SHORT_TEXT" || q.type === "URL" ? (
                      <input
                        type={q.type === "URL" ? "url" : "text"}
                        className={FIELD}
                        placeholder={q.type === "URL" ? "https://" : ""}
                        value={value}
                        onChange={(e) => set(e.target.value)}
                        style={border}
                      />
                    ) : (
                      <textarea
                        rows={4}
                        className={`${FIELD} resize-y leading-[1.65]`}
                        value={value}
                        onChange={(e) => set(e.target.value)}
                        style={border}
                      />
                    )}
                  </Field>
                );
              })}
            </>
          ) : null}

          <div className="mt-[clamp(26px,4vw,34px)] grid gap-3">
            {[
              { key: "rules", on: acceptRules, set: setAcceptRules, label: "I have read the rules and confirm the work will be built during the event window." },
              { key: "conduct", on: acceptConduct, set: setAcceptConduct, label: "I accept the code of conduct." },
              { key: "share", on: shareProfile, set: setShareProfile, label: "Share my profile with mentors and partners (optional)." },
            ].map((a) => (
              <div key={a.key}>
                <label className="flex cursor-pointer items-start gap-[11px]">
                  <input
                    type="checkbox"
                    checked={a.on}
                    onChange={(e) => a.set(e.target.checked)}
                    aria-invalid={show(a.key) ? true : undefined}
                    aria-describedby={show(a.key) ? `${a.key}-error` : undefined}
                    className="mt-[3px] h-[17px] w-[17px] flex-none accent-action"
                  />
                  <span className="text-ui leading-[1.55]">{a.label}</span>
                </label>
                {show(a.key) ? (
                  <span id={`${a.key}-error`} className="ml-7 mt-1.5 block text-small text-danger">
                    {show(a.key)}
                  </span>
                ) : null}
              </div>
            ))}
          </div>

          {error ? (
            <Notice className="mt-5">{error}</Notice>
          ) : tried && Object.keys(missing).length > 0 ? (
            <Notice className="mt-5">
              {Object.keys(missing).length === 1
                ? "One answer needs attention."
                : `${Object.keys(missing).length} answers need attention.`}{" "}
              Fix the fields marked above to register.
            </Notice>
          ) : null}

          <div className="mt-[clamp(26px,4vw,36px)] flex flex-wrap items-center gap-3.5">
            <button type="button" onClick={() => void submit()} disabled={busy} className="btn-primary disabled:opacity-40">
              {busy ? "Registering..." : "Complete registration"}
            </button>
            <span className="text-small leading-[1.5] text-muted">
              Registering grants you the participant role in this event only.
            </span>
          </div>
        </>
      )}
    </main>
  );
}
