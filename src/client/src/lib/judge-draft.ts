import type { Draft } from "@/components/judge/types";

const key = (slug: string) => `podium:judge-drafts:${slug}`;

/**
 * Unsubmitted scores are kept in this browser so moving between projects, a
 * refresh or a dropped connection never costs a judge their work. They are not
 * on the server until submitted, and they stay on this device.
 */
export function readDrafts(slug: string): Record<string, Draft> {
  try {
    const raw = window.localStorage.getItem(key(slug));
    return raw ? (JSON.parse(raw) as Record<string, Draft>) : {};
  } catch {
    return {};
  }
}

export function writeDrafts(slug: string, drafts: Record<string, Draft>): void {
  try {
    if (Object.keys(drafts).length === 0) window.localStorage.removeItem(key(slug));
    else window.localStorage.setItem(key(slug), JSON.stringify(drafts));
  } catch {
    // Storage can be full or blocked; the page still works, drafts just do not persist.
  }
}
