"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { useSession } from "@/components/providers/session-provider";
import { ApiError, post } from "@/lib/api";

function ConsumeLink() {
  const params = useSearchParams();
  const router = useRouter();
  const { refresh } = useSession();
  const token = params.get("token");
  // A link works once. Development strict mode runs effects twice, and the
  // second attempt would report a used link right after the first succeeded.
  const attempted = useRef(false);

  const [state, setState] = useState<"working" | "done" | "error">("working");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (attempted.current) return;
    attempted.current = true;

    if (!token) {
      setMessage("This link is missing its token.");
      setState("error");
      return;
    }
    post("/auth/magic-link/consume", { token })
      .then(async () => {
        await refresh();
        setState("done");
        router.push("/my-events");
      })
      .catch((err: unknown) => {
        setMessage(err instanceof ApiError ? err.message : "This link could not be used.");
        setState("error");
      });
  }, [token, refresh, router]);

  return (
    <main className="screen max-w-[720px] pt-[clamp(40px,7vw,76px)]">
      <h1 className="display text-page">
        {state === "error" ? "This link cannot be used." : state === "done" ? "You are signed in." : "Signing you in..."}
      </h1>
      {state === "error" ? (
        <>
          <p role="alert" className="mt-4 max-w-[56ch] text-body leading-[1.65] text-muted">
            {message} Sign-in links work once and expire 15 minutes after they are issued. Request a
            new one from the sign-in page.
          </p>
          <div className="mt-8 flex flex-wrap gap-2.5">
            <Link href="/auth" className="btn-primary">
              Back to sign in
            </Link>
            <Link href="/events" className="btn">
              Browse events
            </Link>
          </div>
        </>
      ) : (
        <p role="status" className="mt-4 max-w-[56ch] text-body leading-[1.65] text-muted">
          {state === "done" ? "Opening My events." : "Checking the link and opening your session."}
        </p>
      )}
    </main>
  );
}

export default function SignInLinkPage() {
  return (
    <Suspense fallback={null}>
      <ConsumeLink />
    </Suspense>
  );
}
