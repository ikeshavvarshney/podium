/** The event link the server would derive from a name. Mirrors `slugify` in the API. */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export interface SlugCheck {
  slug: string;
  available: boolean;
  reason?: string;
  suggestion?: string;
}
