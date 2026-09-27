"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ApiError, get, post } from "@/lib/api";

interface KeyInfo {
  algorithm: string;
  format: string;
  publicKey: string;
}

interface VerifyResult {
  valid: boolean;
  hash: string;
  key: KeyInfo;
  payload: Record<string, unknown> | null;
}

export default function VerifyPage() {
  const [key, setKey] = useState<KeyInfo | null>(null);
  const [raw, setRaw] = useState("");
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    get<KeyInfo>("/records/key")
      .then(setKey)
      .catch(() => setKey(null));
  }, []);

  async function verify() {
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const parsed = JSON.parse(raw) as { payload?: unknown; signature?: string };
      if (!parsed.payload || !parsed.signature) {
        throw new Error("That file is missing its payload or signature.");
      }
      setResult(
        await post<VerifyResult>("/records/verify", {
          payload: parsed.payload,
          signature: parsed.signature,
        }),
      );
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "That record could not be read.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="screen max-w-[820px] pt-[clamp(40px,7vw,76px)]">
      <div className="eyebrow tracking-label">Verify a record</div>
      <h1 className="display mt-3.5 max-w-[22ch] text-page">
        Check a signed participation record.
      </h1>
      <p className="mt-4 max-w-[60ch] text-body leading-[1.65] text-muted">
        Paste a record file here. This instance re-derives the exact bytes that were signed from the
        payload you supply and checks them against its public key, so a record can be verified by
        anyone, with or without an account.
      </p>

      <div className="card mt-8 p-5">
        <div className="eyebrow">Instance public key</div>
        {key ? (
          <>
            <code className="mt-2.5 block break-all font-mono text-meta text-muted">
              {key.publicKey}
            </code>
            <div className="mt-2 font-mono text-label text-muted">
              {key.algorithm} · {key.format}
            </div>
          </>
        ) : (
          <p className="mt-2.5 text-small text-muted">The signing key could not be read.</p>
        )}
      </div>

      <div className="mt-6 grid gap-2">
        <label htmlFor="record" className="text-ui font-medium">
          Record JSON
        </label>
        <textarea
          id="record"
          rows={10}
          className="field resize-y font-mono text-small leading-[1.6]"
          placeholder='{"payload": { … }, "signature": "…"}'
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          spellCheck={false}
          autoCapitalize="none"
          autoCorrect="off"
        />
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => void verify()}
            disabled={busy || !raw.trim()}
            className="btn-primary disabled:opacity-40"
          >
            {busy ? "Checking..." : "Verify signature"}
          </button>
          <span className="text-small text-muted">
            Nothing is stored: verification is stateless.
          </span>
        </div>
      </div>

      {error ? (
        <div role="alert" className="mt-5 rounded-[10px] bg-danger-soft px-[13px] py-2.5 text-small text-danger">
          {error}
        </div>
      ) : null}

      {result ? (
        <div
          role="status"
          className="card mt-6 p-5"
          style={{ animation: "pop 320ms cubic-bezier(0.16,1,0.3,1) both" }}
        >
          <div className="flex flex-wrap items-center gap-3">
            <span
              className="status-chip"
              style={
                result.valid
                  ? { background: "var(--ok-bg)", color: "var(--ok-fg)" }
                  : { background: "var(--errbg)", color: "var(--err)" }
              }
            >
              {result.valid ? "Signature valid" : "Signature invalid"}
            </span>
            <code className="break-all font-mono text-meta text-muted">{result.hash}</code>
          </div>
          {result.valid && result.payload ? (
            <pre className="mt-4 overflow-x-auto rounded-md bg-elevated p-3.5 font-mono text-meta leading-[1.7]">
              {JSON.stringify(result.payload, null, 2)}
            </pre>
          ) : (
            <p className="mt-3 text-small leading-[1.6] text-muted">
              The payload does not match this signature. Either the record was edited after it was
              issued, or it was signed by a different instance.
            </p>
          )}
        </div>
      ) : null}

      <div className="mt-8">
        <Link href="/events" className="btn">
          Browse events
        </Link>
      </div>
    </main>
  );
}
