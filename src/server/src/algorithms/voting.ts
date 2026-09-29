/**
 * Community voting mathematics.
 *
 * Two methods are supported and they are not the same thing:
 *
 * SINGLE     one voter may back a submission once, weight 1, cost 1. The tally
 *            is a headcount.
 * QUADRATIC  a voter holds a credit budget and buys weight on a submission at
 *            a cost of weight^2 credits. Backing one project with weight 3
 *            costs 9 credits; spreading 1 across three projects costs 3. The
 *            tally is the sum of weights, not of credits, so the marginal cost
 *            of piling onto a single favourite rises quadratically.
 *
 * Neither method is described as "one person, one vote": under quadratic
 * voting a single voter can legitimately contribute more than one unit of
 * weight to one project, bounded by the budget.
 */

export type VotingMethod = "SINGLE" | "QUADRATIC";

export interface BallotEntry {
  submissionId: string;
  weight: number;
}

export interface BallotCost {
  entries: Array<{ submissionId: string; weight: number; credits: number }>;
  creditsSpent: number;
  creditsRemaining: number;
}

export class BallotError extends Error {}

/** Credits a single weight costs under the given method. */
export function creditCost(method: VotingMethod, weight: number): number {
  if (!Number.isInteger(weight) || weight < 0) {
    throw new BallotError("Vote weight must be a whole number of zero or more.");
  }
  if (method === "SINGLE") {
    if (weight > 1) throw new BallotError("This event allows a single vote per project.");
    return weight;
  }
  return weight * weight;
}

/**
 * Prices a whole ballot and refuses it if it overruns the budget. Entries with
 * weight 0 are kept in the result so a caller can delete previous votes.
 */
export function priceBallot(
  method: VotingMethod,
  creditBudget: number,
  entries: BallotEntry[],
  maxChoices: number | null = null,
): BallotCost {
  const seen = new Set<string>();
  const priced = entries.map((entry) => {
    if (seen.has(entry.submissionId)) {
      throw new BallotError("A ballot may list each project only once.");
    }
    seen.add(entry.submissionId);
    return {
      submissionId: entry.submissionId,
      weight: entry.weight,
      credits: creditCost(method, entry.weight),
    };
  });

  const backed = priced.filter((e) => e.weight > 0).length;
  if (method === "SINGLE" && maxChoices !== null && backed > maxChoices) {
    throw new BallotError(
      maxChoices === 1
        ? "This poll allows one vote per person: vote for a single project."
        : `This poll lets each voter vote for at most ${maxChoices} projects.`,
    );
  }

  const creditsSpent = priced.reduce((sum, e) => sum + e.credits, 0);
  const budget = method === "SINGLE" ? Number.POSITIVE_INFINITY : creditBudget;

  if (creditsSpent > budget) {
    throw new BallotError(
      `This ballot costs ${creditsSpent} credits but only ${creditBudget} are available.`,
    );
  }

  return {
    entries: priced,
    creditsSpent,
    creditsRemaining: budget === Number.POSITIVE_INFINITY ? 0 : budget - creditsSpent,
  };
}

export interface VoteRow {
  submissionId: string;
  weight: number;
  credits: number;
  voterKey: string;
}

export interface TallyRow {
  submissionId: string;
  weight: number;
  voters: number;
  credits: number;
  share: number;
  rank: number;
}

/**
 * Tallies votes into ranked rows. Ranking is on total weight, with ties broken
 * by the number of distinct voters, which prefers broad support over one voter
 * spending a large share of their budget.
 */
export function tally(votes: VoteRow[], submissionIds: string[]): TallyRow[] {
  const byId = new Map<string, { weight: number; credits: number; voters: Set<string> }>();
  for (const id of submissionIds) {
    byId.set(id, { weight: 0, credits: 0, voters: new Set() });
  }

  for (const vote of votes) {
    const row = byId.get(vote.submissionId);
    if (!row) continue;
    row.weight += vote.weight;
    row.credits += vote.credits;
    if (vote.weight > 0) row.voters.add(vote.voterKey);
  }

  const totalWeight = [...byId.values()].reduce((sum, r) => sum + r.weight, 0);

  const rows = [...byId.entries()]
    .map(([submissionId, r]) => ({
      submissionId,
      weight: r.weight,
      voters: r.voters.size,
      credits: r.credits,
      share: totalWeight === 0 ? 0 : r.weight / totalWeight,
      rank: 0,
    }))
    .sort(
      (a, b) =>
        b.weight - a.weight ||
        b.voters - a.voters ||
        a.submissionId.localeCompare(b.submissionId),
    );

  // Dense ranking: equal weight and equal voter counts share a rank.
  let rank = 0;
  let previous: { weight: number; voters: number } | null = null;
  rows.forEach((row, index) => {
    if (!previous || previous.weight !== row.weight || previous.voters !== row.voters) {
      rank = index + 1;
      previous = { weight: row.weight, voters: row.voters };
    }
    row.rank = rank;
  });

  return rows;
}

/**
 * Deterministic per-voter ballot order. The same voter always sees the same
 * order (so a reload does not reshuffle the page under them) while different
 * voters see different orders, which is what kills position bias.
 */
export function shuffleForVoter<T extends { id: string }>(items: T[], voterKey: string): T[] {
  let seed = 2166136261;
  for (let i = 0; i < voterKey.length; i += 1) {
    seed ^= voterKey.charCodeAt(i);
    seed = Math.imul(seed, 16777619) >>> 0;
  }

  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const j = seed % (i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}
