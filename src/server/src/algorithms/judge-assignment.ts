/**
 * Judge assignment. A pure function over plain data so the constraint
 * behaviour can be tested without a database.
 *
 * Goal: give every submission `reviewsPerSubmission` independent evaluations
 * while keeping judge workloads even and never asking anyone to review their
 * own team's work.
 */

export interface AssignableSubmission {
  id: string;
  /** Users on the owning team, who must never be assigned this submission. */
  memberIds: string[];
}

export interface AssignableJudge {
  id: string;
  /** Assignments the judge already holds, which count toward their load. */
  existingSubmissionIds: string[];
}

export interface AssignmentOptions {
  reviewsPerSubmission: number;
  /** Hard cap per judge. Defaults to an even share of the total work. */
  maxPerJudge?: number;
  seed?: number;
}

export interface AssignmentPlan {
  /** New pairs to create. Existing assignments are never duplicated. */
  assignments: Array<{ judgeId: string; submissionId: string; position: number }>;
  /** Submissions that could not reach the target, and why. */
  shortfalls: Array<{ submissionId: string; assigned: number; needed: number; reason: string }>;
  loadByJudge: Record<string, number>;
}

/** Deterministic PRNG, so a plan can be reproduced from its seed. */
function lcg(seed: number): () => number {
  let state = seed % 2147483647;
  if (state <= 0) state += 2147483646;
  return () => {
    state = (state * 16807) % 2147483647;
    return (state - 1) / 2147483646;
  };
}

function shuffle<T>(items: T[], rand: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

export function canJudgeReview(judge: AssignableJudge, submission: AssignableSubmission): boolean {
  // Self-review: a judge is never given their own team's submission.
  return !submission.memberIds.includes(judge.id);
}

/**
 * Greedy assignment with a least-loaded-first choice. Each round gives one
 * reviewer to the submission that is furthest from its target, picking the
 * eligible judge who currently carries the least work. That keeps loads within
 * one of each other in the common case while guaranteeing the hard constraints.
 */
export function planAssignments(
  submissions: AssignableSubmission[],
  judges: AssignableJudge[],
  options: AssignmentOptions,
): AssignmentPlan {
  const target = Math.max(1, options.reviewsPerSubmission);
  const rand = lcg(options.seed ?? 42);

  const load = new Map<string, number>();
  const taken = new Map<string, Set<string>>();
  for (const judge of judges) {
    load.set(judge.id, judge.existingSubmissionIds.length);
    taken.set(judge.id, new Set(judge.existingSubmissionIds));
  }

  const assignedCount = new Map<string, number>();
  for (const submission of submissions) {
    assignedCount.set(
      submission.id,
      judges.filter((j) => j.existingSubmissionIds.includes(submission.id)).length,
    );
  }

  const totalNeeded = submissions.reduce(
    (sum, s) => sum + Math.max(0, target - (assignedCount.get(s.id) ?? 0)),
    0,
  );
  const cap =
    options.maxPerJudge ??
    (judges.length > 0
      ? Math.ceil(totalNeeded / judges.length) +
        Math.max(...judges.map((j) => j.existingSubmissionIds.length), 0)
      : 0);

  const assignments: AssignmentPlan["assignments"] = [];
  const positionByJudge = new Map<string, number>();

  // Shuffling breaks ties without favouring whoever appears first in the list.
  const order = shuffle(submissions, rand);

  let progress = true;
  while (progress) {
    progress = false;

    const pending = order
      .filter((s) => (assignedCount.get(s.id) ?? 0) < target)
      .sort((a, b) => (assignedCount.get(a.id) ?? 0) - (assignedCount.get(b.id) ?? 0));

    for (const submission of pending) {
      const eligible = judges
        .filter(
          (judge) =>
            canJudgeReview(judge, submission) &&
            !taken.get(judge.id)!.has(submission.id) &&
            (load.get(judge.id) ?? 0) < cap,
        )
        .sort((a, b) => (load.get(a.id) ?? 0) - (load.get(b.id) ?? 0));

      const chosen = eligible[0];
      if (!chosen) continue;

      const position = positionByJudge.get(chosen.id) ?? 0;
      positionByJudge.set(chosen.id, position + 1);

      assignments.push({ judgeId: chosen.id, submissionId: submission.id, position });
      taken.get(chosen.id)!.add(submission.id);
      load.set(chosen.id, (load.get(chosen.id) ?? 0) + 1);
      assignedCount.set(submission.id, (assignedCount.get(submission.id) ?? 0) + 1);
      progress = true;
    }
  }

  const shortfalls: AssignmentPlan["shortfalls"] = [];
  for (const submission of submissions) {
    const assigned = assignedCount.get(submission.id) ?? 0;
    if (assigned >= target) continue;

    const eligibleTotal = judges.filter((j) => canJudgeReview(j, submission)).length;
    shortfalls.push({
      submissionId: submission.id,
      assigned,
      needed: target,
      reason:
        eligibleTotal < target
          ? `Only ${eligibleTotal} judges are eligible for this submission.`
          : "Judge capacity is exhausted. Raise the per-judge cap or add judges.",
    });
  }

  // Queue order is randomized per judge to blunt position bias.
  const byJudge = new Map<string, AssignmentPlan["assignments"]>();
  for (const a of assignments) {
    if (!byJudge.has(a.judgeId)) byJudge.set(a.judgeId, []);
    byJudge.get(a.judgeId)!.push(a);
  }
  const finalAssignments: AssignmentPlan["assignments"] = [];
  for (const [judgeId, items] of byJudge) {
    const base = judges.find((j) => j.id === judgeId)?.existingSubmissionIds.length ?? 0;
    shuffle(items, rand).forEach((item, i) => {
      finalAssignments.push({ ...item, position: base + i });
    });
  }

  return {
    assignments: finalAssignments,
    shortfalls,
    loadByJudge: Object.fromEntries(load),
  };
}
