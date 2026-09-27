import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Organizer-written Markdown, rendered with the site's own type. Raw HTML in the source is
 * dropped rather than rendered, and react-markdown strips `javascript:` and similar URLs, so
 * an event description can format text but never inject markup or script. No hooks, so it
 * renders in server components (the event page) and in the editor preview alike.
 */
const components: Components = {
  h1: ({ children }) => <h2 className="m-0 mt-2 text-heading font-semibold tracking-head">{children}</h2>,
  h2: ({ children }) => <h3 className="m-0 mt-2 text-title font-semibold tracking-head">{children}</h3>,
  h3: ({ children }) => <h4 className="m-0 mt-1 text-body font-semibold">{children}</h4>,
  h4: ({ children }) => <h5 className="m-0 text-ui font-semibold">{children}</h5>,
  p: ({ children }) => <p className="m-0 text-prose leading-[1.7] [text-wrap:pretty]">{children}</p>,
  a: ({ href, children }) => {
    const external = Boolean(href && /^https?:\/\//.test(href));
    return (
      <a
        href={href}
        className="text-accent underline underline-offset-2"
        {...(external ? { target: "_blank", rel: "noopener noreferrer nofollow ugc" } : {})}
      >
        {children}
      </a>
    );
  },
  ul: ({ children }) => <ul className="m-0 grid list-disc gap-1.5 pl-6 text-prose leading-[1.65]">{children}</ul>,
  ol: ({ children }) => <ol className="m-0 grid list-decimal gap-1.5 pl-6 text-prose leading-[1.65]">{children}</ol>,
  blockquote: ({ children }) => (
    <blockquote className="m-0 grid gap-2 border-l-2 border-line-strong pl-4 text-muted">{children}</blockquote>
  ),
  code: ({ className, children }) =>
    className ? (
      <code className={`${className} font-mono text-small`}>{children}</code>
    ) : (
      <code className="rounded bg-elevated px-1.5 py-0.5 font-mono text-[0.9em]">{children}</code>
    ),
  pre: ({ children }) => (
    <pre className="m-0 overflow-x-auto rounded-[10px] border border-line bg-elevated p-3.5 leading-[1.55]">{children}</pre>
  ),
  hr: () => <hr className="my-2 border-0 border-t border-line" />,
  img: ({ src, alt }) => (
    <img
      src={typeof src === "string" ? src : undefined}
      alt={alt ?? ""}
      loading="lazy"
      className="max-w-full rounded-[10px] border border-line"
    />
  ),
  table: ({ children }) => (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-ui">{children}</table>
    </div>
  ),
  th: ({ children }) => <th className="border-b border-line-strong px-3 py-2 text-left font-medium">{children}</th>,
  td: ({ children }) => <td className="border-b border-line px-3 py-2 align-top">{children}</td>,
};

export function Markdown({ source, className = "" }: { source: string; className?: string }) {
  return (
    <div className={`grid gap-[14px] ${className}`.trim()}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components} skipHtml>
        {source}
      </ReactMarkdown>
    </div>
  );
}
