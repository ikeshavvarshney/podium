/**
 * The rubric an organizer starts from: four criteria with the 40/25/20/15 split the DOGFOOD
 * judging brief uses, worded for any hackathon. Every criterion is scored out of the same
 * number, which the organizer picks.
 */
export const DEFAULT_CRITERIA = [
  {
    key: "completion",
    label: "Completion and correctness",
    hint: "How far the project got, and whether what it claims actually works.",
    weight: 40,
  },
  {
    key: "soundness",
    label: "Soundness and security",
    hint: "Handles bad input and edge cases; nothing unsafe left open.",
    weight: 25,
  },
  {
    key: "adoption",
    label: "Ease of adoption",
    hint: "Could someone else run, use or build on it tomorrow.",
    weight: 20,
  },
  {
    key: "quality",
    label: "Code quality and innovation",
    hint: "Clean, idiomatic work, and ideas worth borrowing.",
    weight: 15,
  },
] as const;

/** Judges score 1 to this number on every criterion. */
export const DEFAULT_SCALE = 5;
export const SCALE_CHOICES = [3, 4, 5, 7, 10] as const;
/** The ballot draws one button per score, so the scale stays small enough to tap. */
export const MIN_SCALE = 2;
export const MAX_SCALE = 10;

export function clampScale(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_SCALE;
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.round(value)));
}
