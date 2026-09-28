/**
 * Bradley-Terry: P(i beats j) = p_i / (p_i + p_j). Every judge's ordering of a group is read as
 * the pairwise wins it implies, and the strengths are fitted by Hunter's MM algorithm (2004),
 * which increases the likelihood on every step.
 *
 * Unlike a Borda count, a win is worth more against a strong project than a weak one, so a project
 * that happened to land in easy groups is not rewarded for it.
 *
 * Each project also plays one virtual win and one virtual loss against a reference of strength 1.
 * That weak prior keeps an unbeaten or winless project finite and connects a comparison graph
 * that would otherwise fall apart into groups nobody compared.
 */

export interface BradleyTerryRow {
  submissionId: string;
  /** log strength, centred so the geometric mean strength is 1 (score 0). */
  score: number;
  wins: number;
  comparisons: number;
  rank: number;
}

const PRIOR = 1;
const MAX_ITERATIONS = 1000;
const TOLERANCE = 1e-10;

/** Every ordered pair a ranking implies: earlier beats later. */
export function pairwiseWins(orders: string[][]): Array<[winner: string, loser: string]> {
  const pairs: Array<[string, string]> = [];
  for (const order of orders) {
    for (let i = 0; i < order.length; i += 1) {
      for (let j = i + 1; j < order.length; j += 1) pairs.push([order[i]!, order[j]!]);
    }
  }
  return pairs;
}

export function bradleyTerry(orders: string[][], submissionIds: string[]): BradleyTerryRow[] {
  const pairs = pairwiseWins(orders);
  const seen = new Set(pairs.flat());
  const ids = submissionIds.filter((id) => seen.has(id));
  const index = new Map(ids.map((id, i) => [id, i]));
  const n = ids.length;
  if (n === 0) return [];

  const wins = new Array<number>(n).fill(0);
  const games = Array.from({ length: n }, () => new Map<number, number>());
  for (const [w, l] of pairs) {
    const a = index.get(w);
    const b = index.get(l);
    if (a === undefined || b === undefined) continue;
    wins[a]! += 1;
    games[a]!.set(b, (games[a]!.get(b) ?? 0) + 1);
    games[b]!.set(a, (games[b]!.get(a) ?? 0) + 1);
  }

  let p = new Array<number>(n).fill(1);
  for (let iter = 0; iter < MAX_ITERATIONS; iter += 1) {
    const next = p.map((pi, i) => {
      let denom = (2 * PRIOR) / (pi + 1);
      for (const [j, count] of games[i]!) denom += count / (pi + p[j]!);
      return (wins[i]! + PRIOR) / denom;
    });
    const logMean = next.reduce((s, v) => s + Math.log(v), 0) / n;
    const scaled = next.map((v) => v / Math.exp(logMean));
    const change = Math.max(...scaled.map((v, i) => Math.abs(v - p[i]!) / p[i]!));
    p = scaled;
    if (change < TOLERANCE) break;
  }

  const rows = ids.map((id, i) => ({
    submissionId: id,
    score: Math.round(Math.log(p[i]!) * 1e6) / 1e6,
    wins: wins[i]!,
    comparisons: [...games[i]!.values()].reduce((s, c) => s + c, 0),
    rank: 0,
  }));
  rows.sort((a, b) => b.score - a.score || b.comparisons - a.comparisons || a.submissionId.localeCompare(b.submissionId));
  for (let i = 0; i < rows.length; i += 1) {
    rows[i]!.rank = i > 0 && rows[i]!.score === rows[i - 1]!.score ? rows[i - 1]!.rank : i + 1;
  }
  return rows;
}
