import type { CSSProperties } from "react";

export type Tone = "blue" | "violet" | "cyan" | "green" | "orange" | "pink" | "yellow";

/** Sets --k (solid), --ks (light wash) and --kt (text on the wash) for a subtree. */
export function tone(k: Tone): CSSProperties {
  return {
    "--k": `var(--k-${k})`,
    "--ks": `var(--k-${k}-s)`,
    "--kt": `var(--k-${k}-t)`,
  } as CSSProperties;
}
