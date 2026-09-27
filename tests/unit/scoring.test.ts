import { describe, expect, it } from "vitest";
import {
  ScoreValidationError,
  validateBallot,
  weightedTotal,
  type Criterion,
} from "../../src/server/src/algorithms/scoring.js";

const criteria: Criterion[] = [
  { id: "c1", key: "impact", weight: 30, minScore: 1, maxScore: 5 },
  { id: "c2", key: "craft", weight: 25, minScore: 1, maxScore: 5 },
  { id: "c3", key: "original", weight: 20, minScore: 1, maxScore: 5 },
  { id: "c4", key: "demo", weight: 15, minScore: 1, maxScore: 5 },
  { id: "c5", key: "scope", weight: 10, minScore: 1, maxScore: 5 },
];

const ballot = (...values: number[]) =>
  criteria.map((c, i) => ({ criterionId: c.id, value: values[i]! }));

describe("weightedTotal", () => {
  it("scores a perfect ballot as 100", () => {
    expect(weightedTotal(criteria, ballot(5, 5, 5, 5, 5))).toBe(100);
  });

  it("scores a minimum ballot as 0", () => {
    expect(weightedTotal(criteria, ballot(1, 1, 1, 1, 1))).toBe(0);
  });

  it("scores the midpoint as 50", () => {
    expect(weightedTotal(criteria, ballot(3, 3, 3, 3, 3))).toBe(50);
  });

  it("respects the weights", () => {
    // Top marks on the 30% criterion only.
    expect(weightedTotal(criteria, ballot(5, 1, 1, 1, 1))).toBe(30);
    // Top marks on the 10% criterion only.
    expect(weightedTotal(criteria, ballot(1, 1, 1, 1, 5))).toBe(10);
  });

  it("gives a heavier criterion more influence than a lighter one", () => {
    const heavy = weightedTotal(criteria, ballot(5, 3, 3, 3, 3));
    const light = weightedTotal(criteria, ballot(3, 3, 3, 3, 5));
    expect(heavy).toBeGreaterThan(light);
  });

  it("normalizes criteria that use different ranges", () => {
    const mixed: Criterion[] = [
      { id: "a", key: "a", weight: 50, minScore: 1, maxScore: 5 },
      { id: "b", key: "b", weight: 50, minScore: 0, maxScore: 10 },
    ];
    // Both at the top of their own range.
    expect(
      weightedTotal(mixed, [
        { criterionId: "a", value: 5 },
        { criterionId: "b", value: 10 },
      ]),
    ).toBe(100);

    // Both at the midpoint of their own range.
    expect(
      weightedTotal(mixed, [
        { criterionId: "a", value: 3 },
        { criterionId: "b", value: 5 },
      ]),
    ).toBe(50);
  });

  it("ignores values for criteria outside the rubric", () => {
    const withExtra = [...ballot(3, 3, 3, 3, 3), { criterionId: "injected", value: 5 }];
    expect(weightedTotal(criteria, withExtra)).toBe(50);
  });

  it("is deterministic", () => {
    const a = weightedTotal(criteria, ballot(4, 2, 5, 3, 1));
    const b = weightedTotal(criteria, ballot(4, 2, 5, 3, 1));
    expect(a).toBe(b);
  });
});

describe("validateBallot", () => {
  it("accepts a complete, in-range ballot", () => {
    expect(() => validateBallot(criteria, ballot(1, 2, 3, 4, 5))).not.toThrow();
  });

  it("rejects a missing criterion", () => {
    const partial = ballot(3, 3, 3, 3, 3).slice(0, 4);
    try {
      validateBallot(criteria, partial);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ScoreValidationError);
      expect((err as ScoreValidationError).fields.scope).toMatch(/not scored/i);
    }
  });

  it("rejects a score above the range", () => {
    try {
      validateBallot(criteria, ballot(9, 3, 3, 3, 3));
      expect.unreachable("should have thrown");
    } catch (err) {
      expect((err as ScoreValidationError).fields.impact).toMatch(/between 1 and 5/);
    }
  });

  it("rejects a score below the range", () => {
    try {
      validateBallot(criteria, ballot(0, 3, 3, 3, 3));
      expect.unreachable("should have thrown");
    } catch (err) {
      expect((err as ScoreValidationError).fields.impact).toBeTruthy();
    }
  });

  it("rejects a fractional score", () => {
    try {
      validateBallot(criteria, ballot(3.5, 3, 3, 3, 3));
      expect.unreachable("should have thrown");
    } catch (err) {
      expect((err as ScoreValidationError).fields.impact).toMatch(/whole numbers/i);
    }
  });

  it("rejects a duplicated criterion", () => {
    const dupes = [...ballot(3, 3, 3, 3, 3), { criterionId: "c1", value: 5 }];
    try {
      validateBallot(criteria, dupes);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect((err as ScoreValidationError).fields.impact).toMatch(/more than once/i);
    }
  });

  it("rejects a criterion from another rubric", () => {
    const foreign = [...ballot(3, 3, 3, 3, 3), { criterionId: "other-rubric", value: 4 }];
    try {
      validateBallot(criteria, foreign);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect((err as ScoreValidationError).fields["other-rubric"]).toBeTruthy();
    }
  });
});
