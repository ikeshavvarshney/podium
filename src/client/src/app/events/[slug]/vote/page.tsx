"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSession } from "@/components/providers/session-provider";
import { ApiError, get, post } from "@/lib/api";
import { coverHue, hue } from "@/lib/hues";
import { Notice } from "@/components/ui/notice";
import { PageStatus } from "@/components/ui/page-status";

interface BallotSubmission {
  id: string;
  name: string;
  tagline: string | null;
  techTags: string[];
  team: { id: string; name: string };
  track: { id: string; name: string } | null;
}

interface BallotView {
  window: { open: boolean; reason?: string; opensAt: string | null; closesAt: string | null };
  method: "SINGLE" | "QUADRATIC";
  access: "OPEN_LINK" | "EMAIL_GATED" | "AUTHENTICATED";
  creditBudget: number;
  maxChoices: number | null;
  creditsSpent: number;
  needsVerification: boolean;
  verifiedEmail: string | null;
  hideResults: boolean;
  /** Why this viewer's roles rule them out of voting, if they do. */
  ineligibleReason: string | null;
  submissions: BallotSubmission[];
  myVotes: Array<{ submissionId: string; weight: number; credits: number }>;
}

export default function VotePage() {
  const params = useParams<{ slug: string }>();
  const slug = params.slug;
  const { user } = useSession();

  const [ballot, setBallot] = useState<BallotView | null>(null);
  const [weights, setWeights] = useState<Record<string, number>>({});
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const view = await get<BallotView>(`/events/${slug}/voting/ballot`);
      setBallot(view);
      setWeights(Object.fromEntries(view.myVotes.map((v) => [v.submissionId, v.weight])));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "The ballot could not be loaded.");
    }
  }, [slug]);

  useEffect(() => {
    void load();
  }, [load]);

  const spent = useMemo(() => {
    if (!ballot) return 0;
    return Object.values(weights).reduce(
      (sum, w) => sum + (ballot.method === "QUADRATIC" ? w * w : w),
      0,
    );
  }, [weights, ballot]);

  if (!ballot) {
    return (
      <PageStatus eyebrow="Community voting" maxWidth="max-w-[1000px]" error={error} />
    );
  }

  const budget = ballot.creditBudget;
  const over = ballot.method === "QUADRATIC" && spent > budget;
  const ineligible = ballot.ineligibleReason;
  const needsAccount = !user && (ballot.access === "AUTHENTICATED" || Boolean(ineligible));
  const needsEmail = !user && !needsAccount && ballot.needsVerification;
  const backed = Object.values(weights).filter((w) => w > 0).length;
  const overChoices = ballot.method === "SINGLE" && ballot.maxChoices !== null && backed > ballot.maxChoices;

  async function sendCode() {
    setError("");
    try {
      await post(`/events/${slug}/voting/verify`, { email: email.trim() });
      setCodeSent(true);
      setNotice(`A six-digit code is on its way to ${email.trim()}.`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "The code could not be sent.");
    }
  }

  async function confirmCode() {
    setError("");
    try {
      await post(`/events/${slug}/voting/verify/confirm`, { email: email.trim(), code: code.trim() });
      setNotice("Address confirmed. You can vote now.");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "That code was not accepted.");
    }
  }

  function setWeight(id: string, next: number) {
    setWeights((prev) => ({ ...prev, [id]: Math.max(0, next) }));
  }

  async function submit() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const entries = Object.entries(weights).map(([submissionId, weight]) => ({
        submissionId,
        weight,
      }));
      const res = await post<{ creditsSpent: number; creditsRemaining: number }>(`/events/${slug}/votes`, { entries });
      setNotice(
        ballot!.method === "QUADRATIC"
          ? `Ballot recorded. ${res.creditsSpent} credits spent, ${res.creditsRemaining} left.`
          : "Ballot recorded.",
      );
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "That ballot was refused.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="screen max-w-[1000px] pb-[120px] pt-[clamp(26px,4vw,40px)]">
      <div className="eyebrow">Community voting</div>
      <div className="mt-3 flex flex-wrap items-end justify-between gap-y-[18px] gap-x-6">
        <div className="min-w-0 flex-[1_1_320px]">
          <h1 className="display text-page">
            {ballot.method === "QUADRATIC" ? "Spend your credits." : "Back your favourites."}
          </h1>
          <p className="mt-3 max-w-[60ch] text-body leading-[1.6] text-muted">
            {ballot.method === "QUADRATIC"
              ? `You hold ${budget} credits. Backing a project with weight w costs w squared credits, so concentrating on one favourite is deliberately expensive. This is not one person, one vote.`
              : ballot.maxChoices === 1
                ? "One vote per person: back the single project you think should win."
                : ballot.maxChoices
                  ? `Back up to ${ballot.maxChoices} projects. The tally is a headcount.`
                  : "One vote per project. The tally is a headcount."}{" "}
            {ballot.hideResults ? "Standings stay hidden until voting closes." : ""}
          </p>
        </div>
        {ballot.method === "QUADRATIC" ? (
          <div className="card flex-none px-5 py-4 text-center">
            <div className="eyebrow">Credits</div>
            <div
              className="mt-1.5 font-mono text-figure tabular-nums"
              style={{ color: over ? "var(--err)" : "var(--ac)" }}
            >
              {spent}/{budget}
            </div>
          </div>
        ) : null}
      </div>

      {!ballot.window.open ? (
        <div className="mt-6 rounded-[10px] bg-danger-soft px-[13px] py-2.5 text-small text-danger">
          {ballot.window.reason ?? "Community voting is closed."}
        </div>
      ) : null}

      {ineligible && user ? (
        <div className="mt-6 rounded-[10px] bg-danger-soft px-[13px] py-2.5 text-small text-danger">{ineligible}</div>
      ) : null}

      {needsAccount ? (
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <span className="text-ui text-muted">
            {ineligible ?? "This event only accepts ballots from signed-in accounts."}
          </span>
          <Link href={`/auth?next=/events/${slug}/vote`} className="btn-primary">
            Sign in to vote
          </Link>
        </div>
      ) : null}

      {needsEmail ? (
        <div className="mt-6 grid max-w-[420px] gap-2">
          <label htmlFor="voter-email" className="text-ui font-medium">
            Confirm your email to vote
          </label>
          <div className="flex gap-2">
            <input
              id="voter-email"
              type="email"
              className="min-w-0 flex-1 rounded-[10px] border border-line bg-surface px-[13px] py-2.5 font-mono text-small outline-none focus:border-muted"
              placeholder="you@example.org"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <button type="button" onClick={() => void sendCode()} disabled={!email.trim()} className="btn btn-sm disabled:opacity-40">
              {codeSent ? "Resend" : "Send code"}
            </button>
          </div>
          {codeSent ? (
            <div className="flex gap-2">
              <input
                aria-label="Six-digit code"
                inputMode="numeric"
                maxLength={6}
                className="min-w-0 flex-1 rounded-[10px] border border-line bg-surface px-[13px] py-2.5 font-mono text-small tracking-[0.3em] outline-none focus:border-muted"
                placeholder="000000"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              />
              <button type="button" onClick={() => void confirmCode()} disabled={code.length !== 6} className="btn-primary btn-sm disabled:opacity-40">
                Confirm
              </button>
            </div>
          ) : null}
          <span className="text-small leading-[1.5] text-muted">
            Your address is your voter identity: one ballot per address, visible to the organizer.
          </span>
        </div>
      ) : ballot.verifiedEmail ? (
        <p className="mt-6 text-small text-muted">Voting as {ballot.verifiedEmail}.</p>
      ) : null}

      {error ? (
        <Notice className="mt-5">{error}</Notice>
      ) : null}
      {notice ? (
        <Notice tone="success" className="mt-5">{notice}</Notice>
      ) : null}

      <div className="mt-[clamp(24px,3.4vw,34px)] grid gap-3">
        {ballot.submissions.length === 0 ? (
          <p className="text-ui text-muted">No projects have been submitted yet.</p>
        ) : (
          ballot.submissions.map((s) => {
            const weight = weights[s.id] ?? 0;
            const cover = hue(coverHue(s.name));
            const cost = ballot.method === "QUADRATIC" ? weight * weight : weight;
            return (
              <div key={s.id} className="flex min-w-0 flex-wrap items-center gap-y-3 gap-x-4 rounded-xl border border-line bg-surface p-[clamp(14px,2vw,18px)]">
                <span
                  className="grid h-10 w-10 flex-none place-items-center rounded-[10px] font-mono text-body"
                  style={{ background: cover.bg, color: cover.fg }}
                >
                  {s.name.charAt(0).toUpperCase()}
                </span>
                <div className="min-w-0 flex-[1_1_200px]">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="text-body font-medium tracking-head">{s.name}</span>
                    <span className="font-mono text-label uppercase tracking-stamp text-muted">
                      {s.track?.name ?? "No track"}
                    </span>
                  </div>
                  <div className="mt-1 truncate text-small text-muted">{s.tagline ?? s.team.name}</div>
                </div>

                <div className="flex flex-none flex-wrap items-center gap-2">
                  {ballot.method === "QUADRATIC" ? (
                    <>
                      <button
                        type="button"
                        aria-label={`Less weight on ${s.name}`}
                        onClick={() => setWeight(s.id, weight - 1)}
                        disabled={weight === 0}
                        className="h-8 w-8 rounded-md border border-line bg-surface text-body disabled:opacity-40 max-md:h-11 max-md:w-11 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11"
                      >
                        −
                      </button>
                      <span className="w-8 text-center font-mono text-ui tabular-nums">{weight}</span>
                      <button
                        type="button"
                        aria-label={`More weight on ${s.name}`}
                        onClick={() => setWeight(s.id, weight + 1)}
                        className="h-8 w-8 rounded-md border border-line bg-surface text-body max-md:h-11 max-md:w-11 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11"
                      >
                        +
                      </button>
                      <span className="w-[74px] text-right font-mono text-meta text-muted">{cost} credits</span>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setWeight(s.id, weight ? 0 : 1)}
                      className="btn btn-sm"
                      style={weight ? { background: "var(--acs)", color: "var(--act)", borderColor: "transparent" } : undefined}
                    >
                      {weight ? "Backed" : "Back this"}
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3.5">
        <button
          type="button"
          onClick={() => void submit()}
          disabled={busy || over || overChoices || !ballot.window.open || needsAccount || Boolean(ineligible) || needsEmail}
          className="btn-primary disabled:opacity-40"
        >
          {busy ? "Submitting..." : "Submit ballot"}
        </button>
        <span className="text-small leading-[1.5] text-muted">
          {over
            ? `That ballot costs ${spent} credits, which is over your budget of ${budget}.`
            : overChoices
              ? `You can back at most ${ballot.maxChoices} project${ballot.maxChoices === 1 ? "" : "s"}.`
              : "Submitting replaces your previous ballot in full."}
        </span>
      </div>
    </main>
  );
}
