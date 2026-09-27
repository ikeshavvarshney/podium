/**
 * Weighted rubric scoring. Pure functions: no database, no HTTP, no clock.
 * The API layer computes every ballot total through here, and never trusts a
 * total supplied by a client.
 */

export interface Criterion {
  id: string;
  key: string;
  weight: number;
  minScore: number;
  maxScore: number;
}

export interface CriterionValue {
  criterionId: string;
  value: number;
}

export class ScoreValidationError extends Error {
  readonly fields: Record<string, string>;

  constructor(fields: Record<string, string>) {
    super("The ballot is not valid.");
    this.name = "ScoreValidationError";
    this.fields = fields;
  }
}

/**
 * Every criterion must be answered, exactly once, with an integer inside its
 * configured range. Partial ballots are rejected rather than treated as zeros,
 * which would silently punish the project.
 */
export function validateBallot(criteria: Criterion[], values: CriterionValue[]): void {
  const fields: Record<string, string> = {};
  const byId = new Map(criteria.map((c) => [c.id, c]));
  const seen = new Set<string>();

  for (const entry of values) {
    const criterion = byId.get(entry.criterionId);
    if (!criterion) {
      fields[entry.criterionId] = "That criterion does not belong to this rubric.";
      continue;
    }
    if (seen.has(entry.criterionId)) {
      fields[criterion.key] = "Scored more than once.";
      continue;
    }
    seen.add(entry.criterionId);

    if (!Number.isInteger(entry.value)) {
      fields[criterion.key] = "Scores must be whole numbers.";
    } else if (entry.value < criterion.minScore || entry.value > criterion.maxScore) {
      fields[criterion.key] =
        `Score must be between ${criterion.minScore} and ${criterion.maxScore}.`;
    }
  }

  for (const criterion of criteria) {
    if (!seen.has(criterion.id)) fields[criterion.key] = "This criterion is not scored yet.";
  }

  if (Object.keys(fields).length > 0) throw new ScoreValidationError(fields);
}

/**
 * Weighted total on a 0-100 scale.
 *
 * Each criterion score is first mapped to its position within its own range,
 * so criteria with different ranges (1-5 next to 0-10) combine correctly:
 *
 *   fraction = (value - min) / (max - min)
 *   total    = 100 * sum(fraction_i * weight_i) / sum(weight_i)
 */
export function weightedTotal(criteria: Criterion[], values: CriterionValue[]): number {
  const byId = new Map(criteria.map((c) => [c.id, c]));
  const weightSum = criteria.reduce((sum, c) => sum + c.weight, 0);
  if (weightSum <= 0) return 0;

  let acc = 0;
  for (const entry of values) {
    const criterion = byId.get(entry.criterionId);
    if (!criterion) continue;
    const span = criterion.maxScore - criterion.minScore;
    const fraction = span > 0 ? (entry.value - criterion.minScore) / span : 0;
    acc += fraction * criterion.weight;
  }

  return round2((acc / weightSum) * 100);
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
