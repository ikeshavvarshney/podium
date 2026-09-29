"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ScreenSkeleton } from "@/components/layout/screen-skeleton";
import { ApiError, get } from "@/lib/api";
import { utcDateTime } from "@/lib/format";
import {
  downloadCertificatePdf,
  downloadCertificatePng,
  type CertificateFonts,
  type CertificateView,
} from "@/lib/certificate-image";

interface Certificate {
  payload: {
    issuedAt: string;
    event: { slug: string; name: string };
    holder: { name: string; org: string | null };
    roles: string[];
    judging?: { assigned: number; scored: number };
    team: string | null;
    submission: string | null;
    award?: { place: number | null; track: string | null };
  };
  signature: string;
  hash: string;
  key: { algorithm: string };
}

const PLACE = ["First place", "Second place", "Third place"];

function awardLine(award: { place: number | null; track: string | null } | undefined): string | null {
  if (!award) return null;
  const place = award.place ? PLACE[award.place - 1] : null;
  if (place && award.track) return `${place} overall, and winner of the ${award.track} track`;
  if (place) return `${place} overall`;
  return award.track ? `Winner of the ${award.track} track` : null;
}

const ROLE_WORD: Record<string, string> = {
  PARTICIPANT: "participant",
  JUDGE: "judge",
  ADMIN: "organizer",
};

export default function CertificatePage() {
  const params = useParams<{ slug: string }>();
  const slug = params.slug;
  const [certificate, setCertificate] = useState<Certificate | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState<"" | "pdf" | "png">("");
  const nameRef = useRef<HTMLHeadingElement>(null);
  const bodyRef = useRef<HTMLParagraphElement>(null);
  const monoRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    get<Certificate>(`/events/${slug}/certificates/me`)
      .then(setCertificate)
      .catch((err: unknown) =>
        setError(err instanceof ApiError ? err.message : "The certificate could not be issued."),
      );
  }, [slug]);

  if (error) {
    return (
      <main className="screen max-w-[900px]">
        <div className="eyebrow">Certificate</div>
        <h1 className="display mt-3.5 text-page">{error}</h1>
        <Link href={`/events/${slug}`} className="btn mt-8 inline-flex">
          Back to the event
        </Link>
      </main>
    );
  }

  if (!certificate) {
    return (
      <main className="screen max-w-[900px]">
        <ScreenSkeleton rows={2} />
      </main>
    );
  }

  const { payload } = certificate;
  const roles = payload.roles.map((r) => ROLE_WORD[r] ?? r.toLowerCase()).join(" and ");
  const award = awardLine(payload.award);
  const sentence =
    `took part in ${payload.event.name} as ${roles}` +
    (payload.team ? `, with team ${payload.team}` : "") +
    (payload.submission ? `, submitting ${payload.submission}` : "") +
    (payload.judging ? `, evaluating ${payload.judging.scored} of ${payload.judging.assigned} assigned projects` : "") +
    ".";
  const issued = `Issued ${utcDateTime(payload.issuedAt, { year: "numeric", month: "long", day: "numeric" })}`;
  const code = `${certificate.key.algorithm} · sha256 ${certificate.hash}`;
  const view: CertificateView = {
    title: award ? "Certificate of achievement" : "Certificate of participation",
    holder: payload.holder.name,
    org: payload.holder.org,
    award,
    sentence,
    issued,
    code,
  };

  function fonts(): CertificateFonts {
    const family = (el: Element | null, fallback: string) => (el ? getComputedStyle(el).fontFamily : fallback);
    return {
      display: family(nameRef.current, "sans-serif"),
      body: family(bodyRef.current, "sans-serif"),
      mono: family(monoRef.current, "monospace"),
    };
  }

  async function save(kind: "pdf" | "png") {
    setSaving(kind);
    try {
      const filename = `podium-certificate-${slug}.${kind}`;
      if (kind === "pdf") await downloadCertificatePdf(view, fonts(), filename);
      else await downloadCertificatePng(view, fonts(), filename);
    } finally {
      setSaving("");
    }
  }

  function download() {
    const blob = new Blob([JSON.stringify(certificate, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `podium-certificate-${slug}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main className="screen max-w-[900px]">
      <div className="flex flex-wrap items-center gap-2 print:hidden">
        <button type="button" onClick={() => void save("pdf")} disabled={saving !== ""} className="btn-primary btn-sm disabled:opacity-40">
          {saving === "pdf" ? "Preparing..." : "Download PDF"}
        </button>
        <button type="button" onClick={() => void save("png")} disabled={saving !== ""} className="btn btn-sm disabled:opacity-40">
          {saving === "png" ? "Preparing..." : "Download PNG"}
        </button>
        <button type="button" onClick={download} className="btn btn-sm">
          Download signed record
        </button>
        <Link href="/verify" className="btn btn-sm">
          Verify a record
        </Link>
      </div>

      <article
        className="card relative mt-6 overflow-hidden px-[clamp(28px,6vw,64px)] py-[clamp(36px,7vw,72px)] text-center"
        style={{ animation: "pop 520ms cubic-bezier(0.16,1,0.3,1) both" }}
      >
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "var(--el)",
          }}
        />
        <div className="relative">
          <div className="eyebrow tracking-label">{view.title}</div>
          <p className="mt-8 text-ui text-muted">This certifies that</p>
          <h1 ref={nameRef} className="display mt-3 text-landing">{payload.holder.name}</h1>
          {payload.holder.org ? (
            <p className="mt-2 text-ui text-muted">{payload.holder.org}</p>
          ) : null}
          {award ? <p className="mt-5 text-title font-semibold tracking-head text-accent-text">{award}</p> : null}
          <p ref={bodyRef} className="mx-auto mt-7 max-w-[52ch] text-body leading-[1.7]">
            took part in <strong className="font-semibold">{payload.event.name}</strong> as {roles}
            {payload.team ? `, with team ${payload.team}` : ""}
            {payload.submission ? `, submitting ${payload.submission}` : ""}
            {payload.judging ? `, evaluating ${payload.judging.scored} of ${payload.judging.assigned} assigned projects` : ""}.
          </p>
          <div className="mx-auto mt-10 h-px w-40 bg-line" />
          <p className="mt-4 font-mono text-meta text-muted">
            {issued}
          </p>
          <p ref={monoRef} className="mx-auto mt-6 max-w-[60ch] break-all font-mono text-label leading-[1.6] text-muted">
            {code}
          </p>
        </div>
      </article>

      <p className="mt-5 max-w-[64ch] text-small leading-[1.6] text-muted print:hidden">
        The code on the certificate is the digest of a signed record. Download the record and
        anyone can check it on the verify page against this instance&apos;s public key: the
        certificate is evidence, not just an image.
      </p>
    </main>
  );
}
