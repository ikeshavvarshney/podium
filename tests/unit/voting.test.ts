import { describe, expect, it } from "vitest";
import {
  BallotError,
  creditCost,
  priceBallot,
  shuffleForVoter,
  tally,
} from "../../src/server/src/algorithms/voting.js";

describe("credit cost", () => {
  it("charges weight squared under quadratic voting", () => {
    expect(creditCost("QUADRATIC", 0)).toBe(0);
    expect(creditCost("QUADRATIC", 1)).toBe(1);
    expect(creditCost("QUADRATIC", 3)).toBe(9);
    expect(creditCost("QUADRATIC", 10)).toBe(100);
  });

  it("charges one credit per vote under single voting and refuses more", () => {
    expect(creditCost("SINGLE", 1)).toBe(1);
    expect(() => creditCost("SINGLE", 2)).toThrow(BallotError);
  });

  it("refuses fractional or negative weights", () => {
    expect(() => creditCost("QUADRATIC", 1.5)).toThrow(BallotError);
    expect(() => creditCost("QUADRATIC", -1)).toThrow(BallotError);
  });
});

describe("ballot pricing", () => {
  it("prices a spread ballot more cheaply than a concentrated one", () => {
    const spread = priceBallot("QUADRATIC", 100, [
      { submissionId: "a", weight: 1 },
      { submissionId: "b", weight: 1 },
      { submissionId: "c", weight: 1 },
    ]);
    const concentrated = priceBallot("QUADRATIC", 100, [{ submissionId: "a", weight: 3 }]);

    expect(spread.creditsSpent).toBe(3);
    expect(concentrated.creditsSpent).toBe(9);
  });

  it("refuses a ballot that overruns the budget", () => {
    expect(() =>
      priceBallot("QUADRATIC", 10, [
        { submissionId: "a", weight: 3 },
        { submissionId: "b", weight: 2 },
      ]),
    ).toThrow(/costs 13 credits/);
  });

  it("refuses a duplicate project on one ballot", () => {
    expect(() =>
      priceBallot("QUADRATIC", 100, [
        { submissionId: "a", weight: 1 },
        { submissionId: "a", weight: 2 },
      ]),
    ).toThrow(BallotError);
  });

  it("keeps zero-weight entries so previous votes can be cleared", () => {
    const priced = priceBallot("QUADRATIC", 100, [{ submissionId: "a", weight: 0 }]);
    expect(priced.entries).toHaveLength(1);
    expect(priced.creditsSpent).toBe(0);
    expect(priced.creditsRemaining).toBe(100);
  });

  it("does not apply a budget under single voting", () => {
    const priced = priceBallot("SINGLE", 2, [
      { submissionId: "a", weight: 1 },
      { submissionId: "b", weight: 1 },
      { submissionId: "c", weight: 1 },
    ]);
    expect(priced.creditsSpent).toBe(3);
  });

  it("holds single voting to a choice limit when one is set", () => {
    const three = [
      { submissionId: "a", weight: 1 },
      { submissionId: "b", weight: 1 },
      { submissionId: "c", weight: 0 },
    ];
    expect(() => priceBallot("SINGLE", 100, three, 1)).toThrow(BallotError);
    expect(priceBallot("SINGLE", 100, three, 2).creditsSpent).toBe(2);
    expect(priceBallot("SINGLE", 100, three, null).creditsSpent).toBe(2);
  });
});

describe("tally", () => {
  const ids = ["a", "b", "c"];

  it("ranks on total weight and reports share", () => {
    const rows = tally(
      [
        { submissionId: "a", weight: 3, credits: 9, voterKey: "v1" },
        { submissionId: "b", weight: 1, credits: 1, voterKey: "v1" },
        { submissionId: "b", weight: 2, credits: 4, voterKey: "v2" },
      ],
      ids,
    );

    expect(rows.map((r) => r.submissionId)).toEqual(["b", "a", "c"]);
    expect(rows[0]!.weight).toBe(3);
    expect(rows[0]!.voters).toBe(2);
    expect(rows[0]!.share).toBeCloseTo(0.5);
    expect(rows[2]!.weight).toBe(0);
  });

  it("breaks a weight tie in favour of broader support", () => {
    const rows = tally(
      [
        { submissionId: "a", weight: 4, credits: 16, voterKey: "v1" },
        { submissionId: "b", weight: 2, credits: 4, voterKey: "v1" },
        { submissionId: "b", weight: 2, credits: 4, voterKey: "v2" },
      ],
      ["a", "b"],
    );

    expect(rows[0]!.submissionId).toBe("b");
    expect(rows[0]!.voters).toBe(2);
  });

  it("gives genuinely tied rows the same rank", () => {
    const rows = tally(
      [
        { submissionId: "a", weight: 2, credits: 4, voterKey: "v1" },
        { submissionId: "b", weight: 2, credits: 4, voterKey: "v2" },
      ],
      ["a", "b"],
    );
    expect(rows[0]!.rank).toBe(1);
    expect(rows[1]!.rank).toBe(1);
  });

  it("ignores votes for submissions outside the event", () => {
    const rows = tally([{ submissionId: "zz", weight: 5, credits: 25, voterKey: "v1" }], ids);
    expect(rows.every((r) => r.weight === 0)).toBe(true);
  });

  it("returns zero share for every row when nothing has been voted on", () => {
    const rows = tally([], ids);
    expect(rows.every((r) => r.share === 0)).toBe(true);
  });
});

describe("ballot ordering", () => {
  const items = Array.from({ length: 12 }, (_, i) => ({ id: `s${i}` }));

  it("is stable for one voter and different across voters", () => {
    const a1 = shuffleForVoter(items, "user:alice").map((i) => i.id);
    const a2 = shuffleForVoter(items, "user:alice").map((i) => i.id);
    const b1 = shuffleForVoter(items, "user:bob").map((i) => i.id);

    expect(a1).toEqual(a2);
    expect(a1).not.toEqual(b1);
  });

  it("keeps every item exactly once", () => {
    const shuffled = shuffleForVoter(items, "user:carol").map((i) => i.id).sort();
    expect(shuffled).toEqual(items.map((i) => i.id).sort());
  });
});
