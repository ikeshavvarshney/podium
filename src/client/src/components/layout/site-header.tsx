"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { hue, initials, ROLE_HUE } from "@/lib/hues";
import { useSession } from "@/components/providers/session-provider";
import { useShell } from "@/components/providers/shell-context";
import { Logo } from "@/components/layout/logo";
import { STATUS_LABEL } from "@/lib/hues";

export function SiteHeader() {
  const { user, events, loading, signOut } = useSession();
  const { event: shellEvent } = useShell();
  const pathname = usePathname();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  // Organizers get their own events list first, as in the prototype; every
  // account keeps Discover and the events it is registered for.
  const nav = user
    ? [
        ...(user.isOrganizer ? [{ href: "/organizer", label: "Events" }] : []),
        { href: "/events", label: "Discover" },
        { href: "/my-events", label: "My events" },
      ]
    : [{ href: "/events", label: "Discover" }];

  // The header chip shows the account's global standing. Event-scoped roles are
  // shown on the event itself, never here, so nothing implies they are global.
  if (pathname.startsWith("/embed/")) return null;

  // On the public landing page a signed-out visitor sees one clear action instead of an account chip and menu.
  const visitorHome = pathname === "/" && !user && !loading;

  // Global account labels only: Public (signed out), User (signed in), Organizer (may create events).
  // Participant, judge and admin are event roles and are shown on the event itself.
  const accountRole = user ? (user.isOrganizer ? "ORGANIZER" : "USER") : "PUBLIC";
  const roleChip = hue(ROLE_HUE[accountRole] ?? "slate");
  const avatar = hue(user?.avatarHue ?? "slate");

  return (
    <header
      className="sticky top-0 z-40 border-b border-line print:hidden"
      style={{
        background: "var(--hd)",
        backdropFilter: "blur(20px) saturate(180%)",
        WebkitBackdropFilter: "blur(20px) saturate(180%)",
      }}
    >
      <div className="mx-auto flex min-h-[54px] max-w-[1400px] flex-nowrap items-center gap-3 px-[clamp(18px,4vw,28px)]">
        <Link
          href="/"
          title="podium home"
          className="flex flex-none items-center gap-[9px] transition-opacity duration-200 hover:opacity-70 max-md:min-h-[44px] max-md:min-w-[44px] max-md:justify-center [@media(pointer:coarse)]:min-h-[44px]"
        >
          <Logo className="h-[19px]" markOnlyOnMobile={!!shellEvent} />
        </Link>

        <span className="h-[22px] w-px flex-none bg-line max-md:hidden" />

        {shellEvent ? (
          <Link
            href={`/events/${shellEvent.slug}`}
            className="flex min-w-0 flex-1 flex-col justify-center py-1.5 md:hidden"
          >
            <span className="truncate text-ui font-semibold tracking-head">{shellEvent.name}</span>
            <span className="flex items-center gap-1.5 truncate text-small text-muted">
              <span className="truncate">{shellEvent.roles.join(" and ")} here</span>
              <span aria-hidden="true">·</span>
              <span className="truncate">{STATUS_LABEL[shellEvent.status] ?? shellEvent.status}</span>
            </span>
          </Link>
        ) : (
          <span className="flex-1 md:hidden" />
        )}

        <nav aria-label="Main" className="flex min-w-[40px] flex-1 gap-0.5 self-stretch overflow-x-auto max-md:hidden">
          {nav.map((item) => {
            const active =
              item.href === "/events"
                ? pathname === "/events" || (/^\/events\/[^/]+$/.test(pathname) && pathname !== "/events/new")
                : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`whitespace-nowrap border-b-2 px-2 pb-[14px] pt-4 text-ui transition-colors duration-200 ${
                  active
                    ? "border-accent text-text"
                    : "border-transparent text-muted hover:text-text"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        {visitorHome ? (
          <Link href="/auth" className="hb !min-h-[38px] flex-none !px-4 !text-ui max-md:!min-h-[44px] [@media(pointer:coarse)]:!min-h-[44px]">
            Sign in
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="arr" aria-hidden="true">
              <path d="M5 12h14M13 6l6 6-6 6" />
            </svg>
          </Link>
        ) : (
          <span
            title="Your account type. Roles inside an event are shown on the event itself."
            className="chip flex-none whitespace-nowrap uppercase tracking-stamp max-md:hidden"
            style={{ background: roleChip.bg, color: roleChip.fg }}
          >
            account: {accountRole.toLowerCase()}
          </span>
        )}

        <span className={`h-[22px] w-px flex-none bg-line max-md:hidden ${visitorHome ? "hidden" : ""}`} />

        <div className={`relative flex-none ${visitorHome ? "hidden" : ""}`} ref={menuRef}>
          <button
            type="button"
            onClick={() => setMenuOpen((open) => !open)}
            aria-label="Account menu"
            aria-expanded={menuOpen}
            className="flex cursor-pointer items-center gap-[7px] rounded-full border border-line bg-elevated py-[3px] pl-[3px] pr-[9px] transition-colors duration-200 hover:border-muted active:scale-[0.97] max-md:min-h-[44px] [@media(pointer:coarse)]:min-h-[44px]"
          >
            <span
              className="grid h-[27px] w-[27px] place-items-center rounded-full font-mono text-label"
              style={{ background: avatar.bg, color: avatar.fg }}
            >
              {user ? (
                initials(user.name)
              ) : (
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="12" cy="8.5" r="3.4" />
                  <path d="M5.5 19.5c.8-3.2 3.3-4.8 6.5-4.8s5.7 1.6 6.5 4.8" />
                </svg>
              )}
            </span>
            {!user && !loading && (
              <span className="whitespace-nowrap text-small font-medium">Sign in</span>
            )}
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="var(--mu)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M6 9.5l6 6 6-6" />
            </svg>
          </button>

          {menuOpen && (
            <>
              <div className="fixed inset-0 z-50" onClick={() => setMenuOpen(false)} />
              <div
                className="absolute right-0 top-[44px] z-[60] w-[250px] overflow-hidden rounded-[11px] border border-line bg-surface"
                style={{
                  boxShadow: "var(--home-shadow-up)",
                  animation: "pop 220ms cubic-bezier(0.16,1,0.3,1) both",
                }}
              >
                <div className="border-b border-line bg-elevated px-[15px] py-[14px]">
                  <div className="truncate text-ui font-semibold tracking-head">
                    {user ? user.name : "Guest"}
                  </div>
                  <div className="mt-1 truncate font-mono text-label text-muted">
                    {user ? user.email : "not signed in"}
                  </div>
                  <div className="mt-2 text-small text-muted">Account: {accountRole.toLowerCase()}</div>
                </div>

                {user && (
                  <div className="p-1.5">
                    <Link
                      href="/my-events"
                      className="flex w-full items-center gap-2.5 rounded-[10px] px-2.5 py-[9px] text-left text-ui transition-colors hover:bg-elevated"
                    >
                      <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="var(--mu)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <circle cx="12" cy="8.2" r="3.6" />
                        <path d="M5 20c.9-3.6 3.6-5.4 7-5.4s6.1 1.8 7 5.4" />
                      </svg>
                      My events
                    </Link>
                    <Link
                      href="/profile"
                      className="flex w-full items-center gap-2.5 rounded-[10px] px-2.5 py-[9px] text-left text-ui transition-colors hover:bg-elevated"
                    >
                      <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="var(--mu)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M4 7h16M4 12h16M4 17h10" />
                      </svg>
                      Profile and password
                    </Link>
                    <Link
                      href="/settings"
                      className="flex w-full items-center gap-2.5 rounded-[10px] px-2.5 py-[9px] text-left text-ui transition-colors hover:bg-elevated"
                    >
                      <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="var(--mu)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <circle cx="12" cy="12" r="3.2" />
                        <path d="M12 3.5v2M12 18.5v2M3.5 12h2M18.5 12h2M6 6l1.4 1.4M16.6 16.6L18 18M18 6l-1.4 1.4M7.4 16.6L6 18" />
                      </svg>
                      Appearance
                    </Link>
                    {events.length > 0 && (
                      <p className="px-2.5 pb-1 pt-2 font-mono text-label uppercase tracking-label text-muted">
                        {events.length} event{events.length === 1 ? "" : "s"}
                      </p>
                    )}
                  </div>
                )}

                <div className="border-t border-line p-1.5">
                  {user ? (
                    <button
                      type="button"
                      onClick={async () => {
                        await signOut();
                        setMenuOpen(false);
                        router.push("/");
                      }}
                      className="flex w-full cursor-pointer items-center gap-2.5 rounded-[10px] px-2.5 py-[9px] text-left text-ui text-muted transition-colors hover:bg-elevated hover:text-text"
                    >
                      <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M14.5 4.6H6.4A1.4 1.4 0 005 6v12a1.4 1.4 0 001.4 1.4h8.1M17 8.6l3.4 3.4-3.4 3.4M20 12h-9" />
                      </svg>
                      Sign out
                    </button>
                  ) : (
                    <Link
                      href="/auth"
                      className="flex w-full items-center gap-2.5 rounded-[10px] px-2.5 py-[9px] text-left text-ui transition-colors hover:bg-elevated"
                    >
                      <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="var(--mu)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M14.5 4.6H6.4A1.4 1.4 0 005 6v12a1.4 1.4 0 001.4 1.4h8.1M17 8.6l3.4 3.4-3.4 3.4M20 12h-9" />
                      </svg>
                      Sign in
                    </Link>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
