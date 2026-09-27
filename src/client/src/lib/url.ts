/**
 * Turns what people actually paste into a link the server will accept:
 * "github.com/you/project" becomes "https://github.com/you/project". Anything
 * that does not look like a host is returned trimmed and left for isHttpUrl to
 * reject.
 */
export function normalizeUrl(raw: string): string {
  const value = raw.trim();
  if (!value) return "";
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return value;
  if (/^[^\s/]+\.[^\s/]+/.test(value)) return `https://${value}`;
  return value;
}

export function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") && (url.hostname.includes(".") || url.hostname === "localhost");
  } catch {
    return false;
  }
}
