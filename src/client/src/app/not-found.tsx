import Link from "next/link";

export default function NotFound() {
  return (
    <main
      className="mx-auto max-w-[720px] px-[clamp(18px,4vw,28px)] pb-[140px] pt-[clamp(80px,14vw,160px)] text-center"
      style={{ animation: "rise 560ms cubic-bezier(0.16,1,0.3,1) both" }}
    >
      <div className="eyebrow text-meta tracking-label">404 · not found</div>
      <h1 className="display mt-[18px] text-landing">
        This page doesn&apos;t exist.
      </h1>
      <p className="mx-auto mt-4 max-w-[46ch] text-body leading-[1.6] text-muted">
        The event, submission, or screen you&apos;re looking for may have been moved, renamed, or
        never existed.
      </p>
      <div className="mt-[30px] flex flex-wrap justify-center gap-2.5">
        <Link href="/events" className="btn-primary px-5 py-3 text-ui">
          Browse events
        </Link>
        <Link href="/" className="btn px-[18px] py-3 text-ui">
          Back to home
        </Link>
      </div>
    </main>
  );
}
