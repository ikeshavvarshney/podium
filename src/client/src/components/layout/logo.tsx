/**
 * The podium logo. It is the static file public/logo.svg used directly, so there is a single
 * drawing to maintain. Dark theme flips it with a CSS filter (.logo-img in globals.css). With
 * `markOnlyOnMobile`, phones show the badge alone (public/logo-mark.svg) so an event name can
 * use the space.
 */
export function Logo({
  className = "h-9",
  markOnlyOnMobile = false,
}: {
  className?: string;
  markOnlyOnMobile?: boolean;
}) {
  return (
    <span className="inline-flex items-center">
      <img
        src="/logo.svg"
        alt="podium"
        width={244}
        height={52.4}
        className={`logo-img ${className} w-auto ${markOnlyOnMobile ? "max-md:hidden" : ""}`}
      />
      {markOnlyOnMobile ? (
        <img src="/logo-mark.svg" alt="podium" width={44} height={44} className="logo-img h-5 w-auto md:hidden" />
      ) : null}
    </span>
  );
}
