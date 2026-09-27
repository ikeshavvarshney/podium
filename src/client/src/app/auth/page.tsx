"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useId, useRef, useState } from "react";
import { useSession } from "@/components/providers/session-provider";
import { Field } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { Segmented } from "@/components/ui/segmented";
import { ApiError, post } from "@/lib/api";
import { safeNext } from "@/lib/safe-next";
import { tone } from "@/components/home/tone";

type Mode = "signin" | "register";

const INPUT_ATTRS = { autoCapitalize: "none", autoCorrect: "off", spellCheck: false } as const;

/** A password input with a show/hide control. Built here because Field wraps a single control. */
function PasswordField({
  label,
  hint,
  error,
  autoComplete,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  error?: string;
  autoComplete: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const id = useId();
  const noteId = `${id}-note`;
  const [shown, setShown] = useState(false);
  const note = error || hint;
  return (
    <div className="grid gap-[7px]">
      <label htmlFor={id} className="text-ui font-medium">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          name="password"
          type={shown ? "text" : "password"}
          autoComplete={autoComplete}
          aria-describedby={note ? noteId : undefined}
          aria-invalid={error ? true : undefined}
          className="field w-full pr-[68px]"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          {...INPUT_ATTRS}
        />
        <button
          type="button"
          aria-pressed={shown}
          onClick={() => setShown((v) => !v)}
          className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-md px-2.5 py-1.5 text-small text-muted hover:text-text"
        >
          {shown ? "Hide" : "Show"}
        </button>
      </div>
      {note ? (
        <span id={noteId} className={error ? "text-small text-danger" : "text-small leading-[1.5] text-muted"}>
          {note}
        </span>
      ) : null}
    </div>
  );
}

function SignInForm() {
  const params = useSearchParams();
  const router = useRouter();
  const { refresh } = useSession();
  const formRef = useRef<HTMLFormElement>(null);

  const [mode, setMode] = useState<Mode>(params.get("mode") === "register" ? "register" : "signin");
  const [form, setForm] = useState({ email: "", password: "", name: "" });
  const [organizer, setOrganizer] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [linkState, setLinkState] = useState<"idle" | "working" | "issued" | "failed">("idle");

  const next = params.get("next");
  const destination = safeNext(next);
  const fromInvite = destination.startsWith("/invite/");
  const eventSlug = destination.startsWith("/events/") ? destination.split("/")[2] : null;
  const registering = mode === "register";

  // Move focus to the first field that needs attention, so a keyboard or
  // screen reader user lands on the problem rather than at the top of the page.
  useEffect(() => {
    if (Object.keys(errors).length === 0) return;
    formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [errors]);

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  function changeMode(next: Mode) {
    setMode(next);
    setErrors({});
    setMessage("");
    setLinkState("idle");
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setMessage("");

    const missing: Record<string, string> = {};
    if (registering && !form.name.trim()) missing.name = "Enter your name.";
    if (!form.email.trim()) missing.email = "Enter your email address.";
    if (!form.password) missing.password = registering ? "Choose a password." : "Enter your password.";
    if (Object.keys(missing).length > 0) {
      setErrors(missing);
      return;
    }

    setBusy(true);
    setErrors({});
    try {
      if (registering) {
        await post("/auth/register", { ...form, accountType: organizer ? "organizer" : "user" });
      } else {
        await post("/auth/login", { email: form.email, password: form.password });
      }
      await refresh();
      router.push(destination);
    } catch (err) {
      if (err instanceof ApiError) {
        setErrors(err.details ?? {});
        if (!err.details) setMessage(err.message);
      } else {
        setMessage("Could not reach the server. Check your connection and try again.");
      }
    } finally {
      setBusy(false);
    }
  }

  async function requestLink() {
    if (!form.email.trim()) {
      setErrors({ email: "Enter your email address to get a sign-in link." });
      return;
    }
    setErrors({});
    setLinkState("working");
    try {
      await post("/auth/magic-link", { email: form.email.trim() });
      setLinkState("issued");
    } catch (err) {
      if (err instanceof ApiError && err.details?.email) setErrors({ email: err.details.email });
      setLinkState("failed");
    }
  }

  return (
    <main className="screen max-w-[1080px] pt-[clamp(28px,5vw,64px)]">
      <div className="grid items-center gap-[clamp(28px,5vw,72px)] lg:grid-cols-2">
        <div className="min-w-0">
          <span className="eyebrow inline-flex items-center gap-[9px]" style={tone("blue")}>
            <i aria-hidden="true" className="h-2 w-2 rounded-[2px]" style={{ background: "var(--k)" }} />
            {registering ? "New account" : "Welcome back"}
          </span>
          <h1 className="display mt-4 max-w-[16ch] text-page md:text-hero">
            {registering ? "Create your account." : "Sign in to podium."}
          </h1>
          <p className="mt-4 max-w-[46ch] text-body leading-[1.65] text-muted [text-wrap:pretty]">
            One account covers every event you take part in. What you do inside an event is set per
            event, and judge or admin access is always granted by an organizer.
          </p>
          {fromInvite ? (
            <Notice tone="success" className="mt-6 max-w-[46ch]">
              You came from a team invite. Sign in or create an account and the invite is applied
              for you.
            </Notice>
          ) : eventSlug ? (
            <p className="mt-6 max-w-[46ch] text-small leading-[1.55] text-muted">
              You will continue to <span className="font-medium text-text">{eventSlug}</span> after
              signing in.
            </p>
          ) : null}

          <ul className="m-0 mt-8 hidden max-w-[46ch] list-none divide-y divide-line border-y border-line p-0 lg:block">
            {[
              { t: "blue" as const, h: "Public", b: "Browse the gallery and results with no account." },
              { t: "violet" as const, h: "User", b: "Compete in teams, and judge when an organizer invites you." },
              { t: "pink" as const, h: "Organizer", b: "Create and run events. You can still compete or judge elsewhere." },
            ].map((r) => (
              <li key={r.h} className="flex items-start gap-3.5 py-3.5" style={tone(r.t)}>
                <span
                  aria-hidden="true"
                  className="mt-[3px] h-[10px] w-[10px] flex-none rounded-[3px]"
                  style={{ background: "var(--k)" }}
                />
                <span className="text-ui leading-[1.45]">
                  <span className="block font-medium">{r.h}</span>
                  <span className="block text-muted">{r.b}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div
          className="card w-full min-w-0 p-[clamp(20px,4vw,32px)] lg:ml-auto lg:max-w-[460px]"
          style={{ animation: "pop 380ms cubic-bezier(0.16,1,0.3,1) both" }}
        >
          <Segmented
            label="Sign in or create an account"
            value={mode}
            onChange={changeMode}
            options={[
              { id: "signin", label: "Sign in" },
              { id: "register", label: "Create account" },
            ]}
          />

          <form ref={formRef} onSubmit={submit} noValidate className="mt-5 grid gap-4">
            {registering ? (
              <Field label="Name" error={errors.name}>
                <input
                  name="name"
                  autoComplete="name"
                  className="field w-full"
                  value={form.name}
                  onChange={set("name")}
                />
              </Field>
            ) : null}

            <Field label="Email" error={errors.email}>
              <input
                name="email"
                type="email"
                inputMode="email"
                autoComplete="email"
                className="field w-full"
                placeholder="you@example.org"
                value={form.email}
                onChange={set("email")}
                {...INPUT_ATTRS}
              />
            </Field>

            <PasswordField
              label="Password"
              hint={registering ? "At least 10 characters." : undefined}
              error={errors.password}
              autoComplete={registering ? "new-password" : "current-password"}
              value={form.password}
              onChange={(v) => setForm((f) => ({ ...f, password: v }))}
            />

            {registering ? (
              <fieldset className="m-0 min-w-0 border-0 p-0">
                <legend className="mb-2 p-0 text-ui font-medium">What will you do on podium?</legend>
                <div className="grid gap-2.5 sm:grid-cols-2">
                  {[
                    {
                      value: false,
                      title: "Take part in events",
                      body: "Join as a User: compete in teams, or judge when an organizer invites you.",
                    },
                    {
                      value: true,
                      title: "Organize events",
                      body: "Join as an Organizer: create and run events. You can still compete or judge elsewhere.",
                    },
                  ].map((opt) => (
                    <label
                      key={opt.title}
                      className="flex min-h-[44px] cursor-pointer items-start gap-3 rounded-[10px] border border-line-strong bg-surface p-3 text-ui leading-[1.4] transition-[border-color,background-color] duration-200 has-[:checked]:border-[var(--btn-bd)] has-[:checked]:bg-elevated has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--focus)]"
                    >
                      <input
                        type="radio"
                        name="accountType"
                        checked={organizer === opt.value}
                        onChange={() => setOrganizer(opt.value)}
                        className="mt-[3px] h-[16px] w-[16px] flex-none accent-action"
                      />
                      <span>
                        <span className="block font-medium">{opt.title}</span>
                        <span className="mt-0.5 block text-small text-muted">{opt.body}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
            ) : null}

            {message ? <Notice>{message}</Notice> : null}

            <button type="submit" disabled={busy} className="btn-primary w-full py-3 text-ui disabled:opacity-60">
              {busy ? (registering ? "Creating account..." : "Signing in...") : registering ? "Create account" : "Sign in"}
            </button>
          </form>

          {!registering ? (
            <div className="mt-5 border-t border-line pt-4">
              <button
                type="button"
                onClick={() => void requestLink()}
                disabled={linkState === "working"}
                className="cursor-pointer text-small underline underline-offset-[3px] disabled:opacity-60"
              >
                {linkState === "working" ? "Requesting link..." : "Sign in with a one-time link instead"}
              </button>
              <div role="status" className="mt-2 text-small leading-[1.55] text-muted">
                {linkState === "issued"
                  ? "If that address has an account, a one-time link was issued. podium sends no email: the link is printed in the server log, so ask whoever runs this instance for it. It works once and expires after 15 minutes."
                  : linkState === "failed"
                    ? "The link could not be requested. Check the address and try again."
                    : "podium sends no email. The link is printed in the server log for whoever runs this instance."}
              </div>
              <p className="mt-3 text-small leading-[1.55] text-muted">
                Demo instance: the seeded accounts use the password{" "}
                <span className="font-mono text-meta text-text">podium-demo-2026</span>.
              </p>
            </div>
          ) : null}
        </div>
      </div>

      <p className="mt-8 text-small leading-[1.55] text-muted">
        Only browsing? The public gallery needs no account.{" "}
        <Link href="/events" className="underline underline-offset-[3px] hover:text-text">
          Discover events
        </Link>
      </p>
    </main>
  );
}

export default function SignInPage() {
  return (
    <Suspense fallback={null}>
      <SignInForm />
    </Suspense>
  );
}
