"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ApiError, del, get, patch, post } from "@/lib/api";
import { hue, initials, ROLE_HUE } from "@/lib/hues";
import type { EventDetail, EventRole } from "@/lib/types";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Notice } from "@/components/ui/notice";
import { PageStatus } from "@/components/ui/page-status";
import { PageHeader } from "@/components/ui/page-header";
import { can, EVENT_AREAS } from "@/lib/permissions";

interface Membership {
  id: string;
  role: EventRole;
  permissions: string[];
  createdAt: string;
  user: { id: string; name: string; email: string; org: string | null; avatarHue: string };
}

const ROLE_COPY: Record<EventRole, { title: string; blurb: string }> = {
  ADMIN: {
    title: "Admins",
    blurb:
      "Organizer access to this event, limited to the areas you allow or full access. Added directly, with no application step.",
  },
  JUDGE: {
    title: "Judges with access",
    blurb: "A judge sees and scores only the projects the organizers assign to them.",
  },
  PARTICIPANT: {
    title: "Participants",
    blurb: "Registered entrants. They join through registration or a team invite rather than being added here.",
  },
};

export default function ManageRolesPage() {
  const params = useParams<{ slug: string }>();
  const slug = params.slug;

  const [event, setEvent] = useState<EventDetail | null>(null);
  const [members, setMembers] = useState<Membership[]>([]);
  const [error, setError] = useState("");
  const [grantError, setGrantError] = useState("");
  const [notice, setNotice] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<EventRole>("JUDGE");
  const [busy, setBusy] = useState(false);
  const [accessFor, setAccessFor] = useState<Membership | null>(null);
  const [accessError, setAccessError] = useState("");
  const [revoking, setRevoking] = useState<Membership | null>(null);
  const [revokeBusy, setRevokeBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [e, m] = await Promise.all([
        get<EventDetail>(`/events/${slug}`),
        get<Membership[]>(`/events/${slug}/members`),
      ]);
      setEvent(e);
      setMembers(m);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "Could not load the roster for this event.",
      );
    }
  }, [slug]);

  useEffect(() => {
    void load();
  }, [load]);

  async function grant() {
    if (!email.trim()) return;
    setBusy(true);
    setGrantError("");
    setNotice("");
    try {
      const created = await post<Membership>(`/events/${slug}/members`, {
        email: email.trim().toLowerCase(),
        role,
        ...(role === "ADMIN" ? { permissions: [] } : {}),
      });
      setEmail("");
      await load();
      if (role === "ADMIN") {
        setNotice("Admin added with no access yet. Choose what they can do.");
        setAccessFor({ ...created, permissions: [] });
      } else {
        setNotice("Judge access granted.");
      }
    } catch (err) {
      setGrantError(err instanceof ApiError ? err.message : "That role could not be granted.");
    } finally {
      setBusy(false);
    }
  }

  async function revoke(membership: Membership) {
    setGrantError("");
    setRevokeBusy(true);
    try {
      await del(`/events/${slug}/members/${membership.id}`);
      await load();
    } catch (err) {
      setGrantError(err instanceof ApiError ? err.message : "That role could not be revoked.");
    } finally {
      setRevokeBusy(false);
      setRevoking(null);
    }
  }

  async function saveAccess(membership: Membership, permissions: string[]) {
    setAccessError("");
    try {
      const updated = await patch<Membership>(`/events/${slug}/members/${membership.id}`, { permissions });
      setAccessFor({ ...membership, permissions: updated.permissions });
      setMembers((prev) => prev.map((m) => (m.id === membership.id ? { ...m, permissions: updated.permissions } : m)));
    } catch (err) {
      setAccessError(err instanceof ApiError ? err.message : "Access could not be updated.");
    }
  }

  if (error && !event) {
    return (
      <main className="screen max-w-[900px] pt-[clamp(26px,4vw,40px)]">
        <div className="eyebrow">Manage roles</div>
        <h1 className="display mt-3.5 text-page">{error}</h1>
        <Link href="/my-events" className="btn mt-8 inline-flex">
          My events
        </Link>
      </main>
    );
  }

  if (!event) {
    return (
      <PageStatus eyebrow="Manage roles" maxWidth="max-w-[900px]" />
    );
  }

  const byRole = (r: EventRole) => members.filter((m) => m.role === r);
  const fullAccess = event.viewer.fullAccess ?? event.viewer.isEventAdmin;
  const isOwnerRow = (m: Membership) => m.role === "ADMIN" && m.user.id === event.owner.id;
  const accessLabel = (m: Membership) =>
    isOwnerRow(m)
      ? "owner · full access"
      : m.permissions.includes("ALL")
        ? "full access"
        : `${m.permissions.length} of ${EVENT_AREAS.length} areas`;

  return (
    <main className="screen max-w-[900px] pt-[clamp(26px,4vw,40px)] pb-[120px]">
      <PageHeader
        back={{ href: "/my-events", label: "My events" }}
        eyebrow={`Manage roles · ${event.name}`}
        title="Who can judge or administer this event."
        lead="Accounts are a User or an Organizer globally. Judge and admin access is granted here, per event, and every check the API makes is scoped to this event."
      />

      {grantError ? (
        <Notice className="mt-6">{grantError}</Notice>
      ) : null}
      {notice ? (
        <Notice tone="success" className="mt-6">{notice}</Notice>
      ) : null}

      <section className="mt-[clamp(28px,4vw,36px)]">
        <div className="border-b border-line pb-[13px]">
          <h2 className="text-title font-semibold tracking-head">Grant access</h2>
          <p className="mt-1.5 text-small leading-[1.55] text-muted">
            The account must already exist on this instance. Granting a role here never changes what that person can do
            in any other event.
          </p>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {((fullAccess ? ["JUDGE", "ADMIN"] : ["JUDGE"]) as EventRole[]).map((r) => {
            const on = role === r;
            const h = hue(ROLE_HUE[r]!);
            return (
              <button
                key={r}
                type="button"
                onClick={() => setRole(r)}
                className="pill"
                style={
                  on
                    ? { background: h.bg, color: h.fg, borderColor: "transparent" }
                    : undefined
                }
              >
                {r === "JUDGE" ? "Judge" : "Admin"}
              </button>
            );
          })}
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <input
            className="field min-w-0 flex-1 font-mono text-small"
            placeholder="name@organization.org"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void grant()}
          />
          <button type="button" onClick={() => void grant()} disabled={busy} className="btn-primary flex-none disabled:opacity-40">
            {busy ? "Granting..." : role === "ADMIN" ? "Add admin" : "Grant judge role"}
          </button>
        </div>
      </section>

      {(["JUDGE", "ADMIN", "PARTICIPANT"] as EventRole[]).map((r) => {
        const rows = byRole(r);
        return (
          <section key={r} className="mt-[clamp(32px,4vw,42px)]">
            <div className="flex items-baseline justify-between gap-4 border-b border-line pb-[13px]">
              <div>
                <h2 className="text-title font-semibold tracking-head">{ROLE_COPY[r].title}</h2>
                <p className="mt-1.5 max-w-[62ch] text-small leading-[1.55] text-muted">{ROLE_COPY[r].blurb}</p>
              </div>
              <span className="font-mono text-meta text-muted">{rows.length}</span>
            </div>

            {rows.length === 0 ? (
              <div className="mt-3.5 text-small text-muted">Nobody holds this role yet.</div>
            ) : (
              <div className="mt-3.5 grid">
                {rows.map((m) => {
                  const h = hue(m.user.avatarHue);
                  return (
                    <div key={m.id} className="flex flex-wrap items-center gap-x-3.5 gap-y-2 border-b border-line py-[11px]">
                      <span
                        className="grid h-8 w-8 flex-none place-items-center rounded-full font-mono text-meta"
                        style={{ background: h.bg, color: h.fg }}
                      >
                        {initials(m.user.name)}
                      </span>
                      <div className="min-w-0 flex-[1_1_180px]">
                        <div className="text-ui">{m.user.name}</div>
                        <div className="truncate text-small text-muted">
                          {m.user.org ? `${m.user.org} · ` : ""}
                          {m.user.email}
                        </div>
                      </div>
                      {r === "ADMIN" ? (
                        <>
                          <span className="hidden flex-none font-mono text-label uppercase tracking-stamp text-muted sm:inline">
                            {accessLabel(m)}
                          </span>
                          {fullAccess && !isOwnerRow(m) ? (
                            <button type="button" onClick={() => setAccessFor(m)} className="btn btn-sm flex-none">
                              Manage access
                            </button>
                          ) : null}
                        </>
                      ) : null}
                      {r === "PARTICIPANT" || (r === "ADMIN" && (!fullAccess || isOwnerRow(m))) ? null : (
                        <button
                          type="button"
                          onClick={() => setRevoking(m)}
                          className="btn btn-sm flex-none hover:border-danger hover:text-danger"
                        >
                          Revoke
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        );
      })}

      {accessFor ? (
        <div onClick={() => setAccessFor(null)} className="fixed inset-0 z-[60] grid place-items-center bg-black/50 p-6">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="access-title"
            onClick={(e) => e.stopPropagation()}
            className="max-h-[86dvh] w-full max-w-[460px] overflow-y-auto rounded-[14px] border border-line bg-surface p-[clamp(20px,3vw,26px)]"
            style={{ animation: "pop 320ms cubic-bezier(0.16,1,0.3,1) both" }}
          >
            <div className="flex items-center justify-between gap-3">
              <h2 id="access-title" className="text-title font-semibold tracking-head">Manage access</h2>
              <button type="button" aria-label="Close" onClick={() => setAccessFor(null)} className="p-1 text-heading leading-none text-muted">
                ×
              </button>
            </div>
            <div className="mt-1.5 text-small text-muted">
              {accessFor.user.name} · <span className="font-mono">{accessFor.user.email}</span>
            </div>

            {(() => {
              const full = accessFor.permissions.includes("ALL");
              const rows = [
                { id: "ALL", label: "Full access", hint: "Everything an organizer can do, including managing other admins." },
                ...EVENT_AREAS,
              ];
              return (
                <div className="mt-4 grid border-t border-line">
                  {rows.map((area) => {
                    const on = full || accessFor.permissions.includes(area.id);
                    const locked = full && area.id !== "ALL";
                    return (
                      <div key={area.id} className="flex items-center gap-4 border-b border-line py-3" style={{ opacity: locked ? 0.55 : 1 }}>
                        <div className="min-w-0 flex-1">
                          <div className={`text-ui ${area.id === "ALL" ? "font-semibold" : ""}`}>{area.label}</div>
                          <div className="text-small leading-[1.5] text-muted">{area.hint}</div>
                        </div>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={on}
                          aria-label={area.label}
                          disabled={locked}
                          onClick={() => {
                            const next =
                              area.id === "ALL"
                                ? full
                                  ? []
                                  : ["ALL"]
                                : on
                                  ? accessFor.permissions.filter((p) => p !== area.id)
                                  : [...accessFor.permissions, area.id];
                            void saveAccess(accessFor, next);
                          }}
                          className="relative h-6 w-[42px] flex-none rounded-full border p-0 [transition:background-color_420ms_cubic-bezier(0.33,1,0.68,1)_60ms,border-color_260ms] disabled:cursor-not-allowed"
                          style={{ background: on ? "var(--ac)" : "var(--el)", borderColor: on ? "var(--ac)" : "var(--ln)" }}
                        >
                          <span
                            className="absolute top-[2px] h-[18px] w-[18px] rounded-full [transition:left_260ms_cubic-bezier(0.16,1,0.3,1)]"
                            style={{ left: on ? "21px" : "2px", background: on ? "var(--bg)" : "var(--mu)" }}
                          />
                        </button>
                      </div>
                    );
                  })}
                </div>
              );
            })()}

            {accessError ? <p className="mt-2 text-small text-danger">{accessError}</p> : null}
            <p className="mt-3 text-small leading-[1.5] text-muted">Changes save as you switch them. The server checks every request.</p>
            <button type="button" onClick={() => setAccessFor(null)} className="btn-primary mt-[14px] w-full">
              Done
            </button>
          </div>
        </div>
      ) : null}

      <ConfirmDialog
        open={revoking !== null}
        title={revoking ? `Revoke ${revoking.user.name} as ${revoking.role === "ADMIN" ? "admin" : "judge"}?` : ""}
        confirmLabel="Revoke"
        tone="danger"
        busy={revokeBusy}
        onConfirm={() => revoking && void revoke(revoking)}
        onCancel={() => setRevoking(null)}
      >
        {revoking ? (
          <p className="m-0">
            {revoking.user.name} ({revoking.user.email}) loses {revoking.role === "ADMIN" ? "admin" : "judge"} access to{" "}
            {event.name} right away. You can grant it again later.
          </p>
        ) : null}
      </ConfirmDialog>
    </main>
  );
}
