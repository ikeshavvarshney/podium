"use client";

import Link from "next/link";
import { useAppearance, type ThemeName } from "@/components/providers/appearance";

const THEMES: Array<{
  id: ThemeName;
  label: string;
  swatchBg: string;
  ink: string;
  muted: string;
  border: string;
}> = [
  { id: "light", label: "Light", swatchBg: "#ffffff", ink: "#0b0b0e", muted: "#4c4c58", border: "#e6e6ea" },
  { id: "dark", label: "Dark", swatchBg: "#0b0d13", ink: "#eceef4", muted: "#a5abb8", border: "#2c303a" },
];

export default function SettingsPage() {
  const { theme, setTheme } = useAppearance();

  return (
    <main className="screen max-w-[1180px] pb-[120px] pt-[clamp(30px,5vw,46px)]">
      <div className="max-w-[780px]">
        <div className="eyebrow">Settings</div>
        <h1 className="display mt-3.5 text-page">Appearance.</h1>
        <p className="mt-3.5 text-ui leading-[1.6] text-muted">
          Rubric weights, judge panels and exports live inside each event. Open an event from{" "}
          <Link href="/my-events" className="underline">
            My events
          </Link>{" "}
          to manage them. Everything on this page is a local preference: it is stored in this browser and never sent to
          the server.
        </p>

        <section className="mt-12">
          <div className="border-b border-line pb-3.5">
            <h2 className="text-title font-semibold tracking-head">Theme</h2>
            <p className="mt-1.5 text-ui text-muted">
              Light is the default. Your choice applies to every screen on this device.
            </p>
          </div>
          <div className="mt-[22px] grid gap-3.5 [grid-template-columns:repeat(auto-fit,minmax(200px,1fr))]">
            {THEMES.map((t) => {
              const on = theme === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTheme(t.id)}
                  className="overflow-hidden rounded-[10px] border p-0 text-left [transition:border-color_220ms,transform_420ms_cubic-bezier(0.33,1,0.68,1)_60ms] hover:-translate-y-0.5"
                  style={{ borderColor: on ? "var(--ac)" : "var(--ln)" }}
                >
                  <div
                    className="flex h-[76px] items-end gap-1.5 border-b p-3.5"
                    style={{ background: t.swatchBg, borderBottomColor: t.border }}
                  >
                    <span className="h-2 w-[34px] rounded-[3px]" style={{ background: t.ink }} />
                    <span className="h-2 w-[22px] rounded-[3px]" style={{ background: t.muted }} />
                    <span className="h-2 w-3 rounded-[3px]" style={{ background: "var(--ac)" }} />
                  </div>
                  <div className="flex items-baseline gap-2.5 px-4 py-3.5">
                    <span className="text-ui font-medium">{t.label}</span>
                    <span
                      className="ml-auto font-mono text-label tracking-stamp"
                      style={{ color: on ? "var(--ac)" : "var(--mu)" }}
                    >
                      {on ? "active" : "select"}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        <section className="mt-14">
          <div className="border-b border-line pb-3.5">
            <h2 className="text-title font-semibold tracking-head">Account</h2>
            <p className="mt-1.5 text-ui text-muted">
              Your name, organization, avatar colour, password and sessions are account data, not preferences, so they
              live on your profile.
            </p>
          </div>
          <div className="mt-5 flex flex-wrap gap-2.5">
            <Link href="/profile" className="btn">
              Open profile
            </Link>
          </div>
        </section>
      </div>
    </main>
  );
}
