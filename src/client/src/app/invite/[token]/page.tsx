"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useSession } from "@/components/providers/session-provider";
import { ApiError, post } from "@/lib/api";
import type { Team } from "@/lib/types";

export default function AcceptInvitePage() {
  const params = useParams<{ token: string }>();
  const { user, loading, refresh } = useSession();

  const [state, setState] = useState<"idle" | "working" | "done" | "error">("idle");
  const [team, setTeam] = useState<Team | null>(null);
  const [message, setMessage] = useState("");
  // Strict mode runs effects twice in development; an invite can only be accepted once.
  const started = useRef(false);

  useEffect(() => {
    if (loading || !user || state !== "idle" || started.current) return;
    started.current = true;

    setState("working");
    post<Team>("/invites/accept", { token: params.token })
      .then(async (joined) => {
        setTeam(joined);
        setState("done");
        await refresh();
      })
      .catch((err: unknown) => {
        setMessage(err instanceof ApiError ? err.message : "This invite could not be used.");
        setState("error");
      });
  }, [loading, user, state, params.token, refresh]);

  return (
    <main className="screen max-w-[720px] pt-[clamp(40px,7vw,76px)]">
      {loading ? (
        <h1 className="display text-page">Checking your session...</h1>
      ) : !user ? (
        <>
          <h1 className="display text-page">You have been invited to join a team.</h1>
          <p className="mt-4 max-w-[56ch] text-body leading-[1.65] text-muted">
            Joining adds you to the team and registers you for its event, so we need to know who you
            are first. Sign in or create an account and the invite is applied automatically.
          </p>
          <div className="mt-8 flex flex-wrap gap-2.5">
            <Link href={`/auth?next=/invite/${params.token}`} className="btn-primary">
              Sign in or create an account
            </Link>
            <Link href="/events" className="btn">
              Browse events instead
            </Link>
          </div>
        </>
      ) : state === "working" || state === "idle" ? (
        <h1 role="status" className="display text-page">Joining the team...</h1>
      ) : state === "done" && team ? (
        <>
          <h1 role="status" className="display text-page">You are on {team.name}.</h1>
          <p className="mt-4 max-w-[56ch] text-body leading-[1.65] text-muted">
            You are also registered for the event. Open it from My events to start on the
            submission with your team.
          </p>
          <div className="mt-8 flex flex-wrap gap-2.5">
            <Link href="/my-events" className="btn-primary">
              Open My events
            </Link>
          </div>
        </>
      ) : (
        <>
          <h1 className="display text-page">This invite cannot be used.</h1>
          <p role="alert" className="mt-4 max-w-[56ch] text-body leading-[1.65] text-muted">
            {message} Ask the teammate who sent it for a new invite link, or browse events to find
            a team on the board.
          </p>
          <div className="mt-8 flex flex-wrap gap-2.5">
            <Link href="/events" className="btn-primary">
              Browse events
            </Link>
            <Link href="/my-events" className="btn">
              My events
            </Link>
          </div>
        </>
      )}
    </main>
  );
}
