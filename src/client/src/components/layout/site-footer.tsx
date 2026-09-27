"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Logo } from "@/components/layout/logo";

const COLUMNS: Array<{ title: string; links: Array<{ href: string; label: string }>; note?: string }> = [
  {
    title: "Platform",
    links: [
      { href: "/events", label: "Discover events" },
      { href: "/", label: "About" },
    ],
  },
  {
    title: "Organizers",
    links: [
      { href: "/events/new", label: "Create an event" },
      { href: "/organizer", label: "Manage events" },
      { href: "/verify", label: "Verify a record" },
    ],
    note: "REST API at /api",
  },
  {
    title: "Participants",
    links: [
      { href: "/my-events", label: "My events" },
      { href: "/profile", label: "Profile" },
      { href: "/auth", label: "Sign in / register" },
    ],
  },
];

export function SiteFooter() {
  const pathname = usePathname();
  if (pathname.startsWith("/embed/")) return null;

  return (
    <footer className="border-t border-line bg-surface print:hidden">
      <div className="mx-auto grid max-w-[1400px] gap-x-8 gap-y-5 px-[clamp(18px,4vw,28px)] pb-5 pt-[clamp(24px,3vw,36px)] [grid-template-columns:minmax(180px,1.3fr)_repeat(auto-fit,minmax(120px,1fr))]">
        <div className="min-w-0">
          <Link href="/" aria-label="podium home" className="inline-flex transition-opacity duration-200 hover:opacity-70">
            <Logo className="h-[26px]" />
          </Link>
          <p className="mt-2.5 max-w-[38ch] text-small leading-[1.6] text-muted">
            Registration, judging and results for hackathons, run end to end with role-scoped access
            enforced at the API layer.
          </p>
        </div>

        {COLUMNS.map((column) => (
          <div key={column.title} className="min-w-0">
            <div className="text-small font-semibold text-text">
              {column.title}
            </div>
            <div className="mt-2 grid gap-[6px] max-md:gap-0 [@media(pointer:coarse)]:gap-0">
              {column.links.map((link) => (
                <Link
                  key={link.label}
                  href={link.href}
                  className="flex items-center text-small text-muted transition-colors duration-200 hover:text-text max-md:min-h-[44px] [@media(pointer:coarse)]:min-h-[44px]"
                >
                  {link.label}
                </Link>
              ))}
              {column.note ? <span className="text-small text-muted">{column.note}</span> : null}
            </div>
          </div>
        ))}
      </div>

      <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-x-4 gap-y-1 border-t border-line/60 px-[clamp(18px,4vw,28px)] pb-4 pt-3">
        <span className="font-mono text-meta text-muted/80">
          podium · MIT · self-hosted, offline-first
        </span>
        <span className="font-mono text-meta text-muted/80 sm:ml-auto">
          no external services at runtime
        </span>
      </div>
    </footer>
  );
}
