"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { NotificationPrefs, ProfilePanels } from "@/components/profile/profile-panels";
import { useSession } from "@/components/providers/session-provider";
import { ApiError, patch, post } from "@/lib/api";
import { hue, HUE_NAMES, initials, ROLE_HUE } from "@/lib/hues";
import { Notice } from "@/components/ui/notice";
import { StatusChip } from "@/components/ui/status-chip";

const FIELD =
  "bg-surface border border-line-strong rounded-[10px] px-3 py-[9px] text-ui text-text outline-none focus:border-muted";

export default function ProfilePage() {
  const { user, events, loading, refresh } = useSession();

  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const [name, setName] = useState("");
  const [org, setOrg] = useState("");
  const [pronouns, setPronouns] = useState("");
  const [bio, setBio] = useState("");
  const [link, setLink] = useState("");
  const [avatarHue, setAvatarHue] = useState("slate");

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [passwordError, setPasswordError] = useState("");

  useEffect(() => {
    if (!user) return;
    setName(user.name);
    setOrg(user.org ?? "");
    setPronouns(user.pronouns ?? "");
    setBio(user.bio ?? "");
    setLink(user.link ?? "");
    setAvatarHue(user.avatarHue);
  }, [user]);

  if (loading) {
    return (
      <main className="screen max-w-[1180px]">
        <div className="eyebrow">Profile</div>
        <div className="mt-8 h-28 rounded-xl bg-elevated" />
      </main>
    );
  }

  if (!user) {
    return (
      <main className="screen max-w-[1180px]">
        <div className="eyebrow">Profile</div>
        <h1 className="display mt-3.5 text-page">Sign in to see your profile.</h1>
        <div className="mt-8 flex flex-wrap gap-2.5">
          <Link href="/auth?next=/profile" className="btn-primary">
            Sign in
          </Link>
          <Link href="/events" className="btn">
            Browse events
          </Link>
        </div>
      </main>
    );
  }

  async function save() {
    setBusy(true);
    setError("");
    try {
      await patch("/auth/me", {
        name: name.trim(),
        org: org.trim() || null,
        pronouns: pronouns.trim() || null,
        bio: bio.trim() || null,
        link: link.trim() || null,
        avatarHue,
      });
      await refresh();
      setEditing(false);
      setSaved("Profile saved");
      window.setTimeout(() => setSaved(""), 1800);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Your profile could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  async function changePassword() {
    setPasswordError("");
    setBusy(true);
    try {
      await post("/auth/password", { currentPassword, newPassword });
      setCurrentPassword("");
      setNewPassword("");
      setSaved("Password changed, other sessions signed out");
      window.setTimeout(() => setSaved(""), 2600);
      await refresh();
    } catch (err) {
      setPasswordError(err instanceof ApiError ? err.message : "The password could not be changed.");
    } finally {
      setBusy(false);
    }
  }

  const avatar = hue(user.avatarHue);
  const roleLabel = user.isOrganizer ? "Organizer" : "User";
  const roleChip = hue(ROLE_HUE[user.isOrganizer ? "ORGANIZER" : "USER"]!);

  const rows = [
    { label: "Display name", value: user.name },
    { label: "Contact email", value: user.email },
    { label: "Affiliation", value: user.org ?? "Not set" },
    { label: "Pronouns", value: user.pronouns ?? "Not set" },
    { label: "Short bio", value: user.bio ?? "Not set" },
    { label: "Website", value: user.link ?? "Not set" },
  ];


  return (
    <main className="screen max-w-[1180px] pb-[120px] pt-[clamp(30px,5vw,46px)]">
      <div className="flex flex-wrap items-center gap-[clamp(16px,3vw,22px)] border-b border-line pb-[clamp(22px,4vw,30px)]">
        <span
          className="grid h-[62px] w-[62px] flex-none place-items-center rounded-full text-heading font-medium tracking-head"
          style={{ background: avatar.bg, color: avatar.fg }}
        >
          {initials(user.name)}
        </span>
        <div className="min-w-0 flex-[1_1_220px]">
          <h1 className="font-display text-console font-[560] leading-[1.08] tracking-[-0.035em]">{user.name}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-[9px]">
            <StatusChip hue={roleChip}>
              {roleLabel}
            </StatusChip>
            <span className="text-ui text-muted">{user.org ?? user.email}</span>
            {user.pronouns ? <span className="text-ui text-muted">· {user.pronouns}</span> : null}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {saved ? <StatusChip tone="success">{saved}</StatusChip> : null}
          {!editing ? (
            <button type="button" onClick={() => setEditing(true)} className="btn-primary">
              Edit profile
            </button>
          ) : null}
          <Link href="/settings" className="btn">
            Preferences
          </Link>
        </div>
      </div>

      <div className="mt-[clamp(30px,5vw,44px)] grid items-start gap-[clamp(32px,5vw,52px)] [grid-template-columns:repeat(auto-fit,minmax(min(300px,100%),1fr))]">
        <section className="min-w-0">
          <div className="flex items-baseline justify-between gap-3">
            <div className="eyebrow tracking-label">Account details</div>
            <span className="text-small text-muted">Changes apply across every screen.</span>
          </div>

          {error ? (
            <Notice className="mt-3">{error}</Notice>
          ) : null}

          {!editing ? (
            <div className="mt-1.5">
              {rows.map((r) => (
                <div
                  key={r.label}
                  className="-mx-2 flex items-baseline justify-between gap-[18px] rounded-md border-b border-line px-2 py-[13px] hover:bg-elevated"
                >
                  <span className="flex-none text-ui text-muted">{r.label}</span>
                  <span className="min-w-0 truncate text-right text-ui">{r.value}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="mt-2.5">
              {[
                { label: "Name", value: name, set: setName, required: true, area: false, hint: "" },
                { label: "Organization", value: org, set: setOrg, required: false, area: false, hint: "Shown next to your name on panels and teams." },
                { label: "Pronouns", value: pronouns, set: setPronouns, required: false, area: false, hint: "" },
                { label: "Link", value: link, set: setLink, required: false, area: false, hint: "A full URL, including https://" },
                { label: "Bio", value: bio, set: setBio, required: false, area: true, hint: "" },
              ].map((f) => (
                <div key={f.label} className="grid gap-[7px] border-b border-line py-[15px]">
                  <div className="flex items-baseline gap-2.5">
                    <label className="text-ui font-medium">{f.label}</label>
                    <span className="font-mono text-label uppercase tracking-stamp text-muted">
                      {f.required ? "required" : "optional"}
                    </span>
                  </div>
                  {f.area ? (
                    <textarea
                      className={`${FIELD} min-h-[90px] resize-y leading-[1.6]`}
                      value={f.value}
                      onChange={(e) => f.set(e.target.value)}
                    />
                  ) : (
                    <input className={FIELD} value={f.value} onChange={(e) => f.set(e.target.value)} />
                  )}
                  {f.hint ? <span className="text-small leading-[1.5] text-muted">{f.hint}</span> : null}
                </div>
              ))}

              <div className="grid gap-2.5 border-b border-line py-4">
                <label className="text-ui font-medium">Avatar colour</label>
                <div className="flex flex-wrap gap-2">
                  {HUE_NAMES.map((h) => {
                    const c = hue(h);
                    return (
                      <button
                        key={h}
                        type="button"
                        aria-label={`Avatar colour ${h}`}
                        onClick={() => setAvatarHue(h)}
                        className="h-[30px] w-[30px] rounded-full border-2 p-0 [transition:border-color_420ms_cubic-bezier(0.33,1,0.68,1)_60ms,transform_420ms_cubic-bezier(0.33,1,0.68,1)_60ms] hover:scale-105"
                        style={{ background: c.bg, borderColor: avatarHue === h ? c.fg : "transparent" }}
                      />
                    );
                  })}
                </div>
              </div>

              <div className="flex flex-wrap gap-2 pt-[18px]">
                <button type="button" onClick={() => void save()} disabled={busy} className="btn-primary disabled:opacity-40">
                  {busy ? "Saving..." : "Save changes"}
                </button>
                <button type="button" onClick={() => setEditing(false)} className="btn">
                  Cancel
                </button>
              </div>
            </div>
          )}

          <NotificationPrefs />

          <div className="eyebrow mt-[clamp(30px,5vw,42px)]">Password</div>
          <p className="mt-2 max-w-[56ch] text-small leading-[1.55] text-muted">
            Changing your password bumps the token version on your account, which invalidates every session signed
            before the change. This session is re-issued for you.
          </p>
          <div className="mt-3 grid gap-2.5">
            <input
              type="password"
              autoComplete="current-password"
              className={FIELD}
              placeholder="Current password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
            />
            <input
              type="password"
              autoComplete="new-password"
              className={FIELD}
              placeholder="New password, at least 10 characters"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
            {passwordError ? <span className="text-small text-danger">{passwordError}</span> : null}
            <div>
              <button
                type="button"
                onClick={() => void changePassword()}
                disabled={busy || !currentPassword || newPassword.length < 10}
                className="btn disabled:opacity-40"
              >
                Change password
              </button>
            </div>
          </div>
        </section>

        <ProfilePanels events={events} />
      </div>
    </main>
  );
}
