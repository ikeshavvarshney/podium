/**
 * Comparative ranking.
 *
 * Instead of asking a judge for an absolute score, the judge orders a small
 * group of projects best to worst. Overlapping groups are combined with a
 * Borda count: in a group of k, the project placed first scores k-1 points,
 * the next k-2, down to 0 for last.
 *
 * This sidesteps calibration entirely, because no judge is ever asked for a
 * number. It needs more comparisons than rubric scoring to separate a field,
 * and it produces no per-criterion feedback, which is why it is an option an
 * organizer chooses rather than the default.
 */

/** Deterministic PRNG so a judge's groups are stable across page loads. */
function lcg(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function seedFrom(text: string): number {
  let seed = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    seed ^= text.charCodeAt(i);
    seed = Math.imul(seed, 16777619) >>> 0;
  }
  return seed >>> 0;
}

export interface Group {
  key: string;
  submissionIds: string[];
}

/**
 * Splits a judge's assigned submissions into ranking groups. The last group is
 * back-filled from earlier items rather than left as a single project, because
 * a group of one carries no comparison.
 */
export function buildGroups(
  submissionIds: string[],
  groupSize: number,
  judgeId: string,
): Group[] {
  const size = Math.max(2, Math.min(6, groupSize));
  if (submissionIds.length < 2) return [];

  const shuffled = [...submissionIds];
  const random = lcg(seedFrom(judgeId));
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
  }

  const groups: string[][] = [];
  for (let i = 0; i < shuffled.length; i += size) {
    groups.push(shuffled.slice(i, i + size));
  }

  const last = groups[groups.length - 1];
  if (groups.length > 1 && last && last.length < 2) {
    const previous = groups[groups.length - 2]!;
    last.unshift(previous[previous.length - 1]!);
  }

  return groups.map((ids) => ({ key: groupKey(ids), submissionIds: ids }));
}

/** Identity of a group, independent of the order a judge puts it in. */
export function groupKey(submissionIds: string[]): string {
  return [...submissionIds].sort().join("|");
}

export interface RankingRow {
  /** Best to worst. */
  order: string[];
}

export interface BordaRow {
  submissionId: string;
  points: number;
  appearances: number;
  firsts: number;
  /** Points as a fraction of the maximum this project could have scored. */
  score: number;
  rank: number;
}

/**
 * Combines finished rankings into one table. `score` normalizes points by the
 * maximum available to that project, so a project that appeared in fewer
 * groups is not punished for it.
 */
export function bordaCount(rankings: RankingRow[], submissionIds: string[]): BordaRow[] {
  const totals = new Map<string, { points: number; max: number; appearances: number; firsts: number }>();
  for (const id of submissionIds) {
    totals.set(id, { points: 0, max: 0, appearances: 0, firsts: 0 });
  }

  for (const ranking of rankings) {
    const k = ranking.order.length;
    if (k < 2) continue;
    ranking.order.forEach((id, index) => {
      const row = totals.get(id);
      if (!row) return;
      row.points += k - 1 - index;
      row.max += k - 1;
      row.appearances += 1;
      if (index === 0) row.firsts += 1;
    });
  }

  const rows = [...totals.entries()]
    .map(([submissionId, r]) => ({
      submissionId,
      points: r.points,
      appearances: r.appearances,
      firsts: r.firsts,
      score: r.max === 0 ? 0 : r.points / r.max,
      rank: 0,
    }))
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.points - a.points ||
        b.appearances - a.appearances ||
        a.submissionId.localeCompare(b.submissionId),
    );

  // Dense ranking on the normalized score, so genuine ties share a rank.
  let rank = 0;
  let previous: number | null = null;
  rows.forEach((row, index) => {
    if (previous === null || previous !== row.score) {
      rank = index + 1;
      previous = row.score;
    }
    row.rank = rank;
  });

  return rows;
}
