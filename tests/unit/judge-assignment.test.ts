import { describe, expect, it } from "vitest";
import {
  canJudgeReview,
  planAssignments,
  type AssignableJudge,
  type AssignableSubmission,
} from "../../src/server/src/algorithms/judge-assignment.js";

const sub = (id: string, memberIds: string[] = []): AssignableSubmission => ({ id, memberIds });

const judge = (id: string, existingSubmissionIds: string[] = []): AssignableJudge => ({ id, existingSubmissionIds });

function countsBySubmission(plan: ReturnType<typeof planAssignments>) {
  const counts = new Map<string, number>();
  for (const a of plan.assignments) {
    counts.set(a.submissionId, (counts.get(a.submissionId) ?? 0) + 1);
  }
  return counts;
}

describe("canJudgeReview", () => {
  it("blocks a judge from reviewing their own team's submission", () => {
    expect(canJudgeReview(judge("j1"), sub("s1", ["j1"]))).toBe(false);
  });

});

describe("planAssignments", () => {
  it("gives every submission the requested number of reviews", () => {
    const submissions = ["s1", "s2", "s3", "s4", "s5", "s6"].map((id) => sub(id));
    const judges = ["j1", "j2", "j3", "j4"].map((id) => judge(id));

    const plan = planAssignments(submissions, judges, { reviewsPerSubmission: 3 });

    expect(plan.shortfalls).toHaveLength(0);
    const counts = countsBySubmission(plan);
    for (const s of submissions) expect(counts.get(s.id)).toBe(3);
  });

  it("never assigns the same judge to a submission twice", () => {
    const submissions = ["s1", "s2", "s3", "s4"].map((id) => sub(id));
    const judges = ["j1", "j2", "j3"].map((id) => judge(id));

    const plan = planAssignments(submissions, judges, { reviewsPerSubmission: 3 });
    const pairs = plan.assignments.map((a) => `${a.judgeId}:${a.submissionId}`);
    expect(new Set(pairs).size).toBe(pairs.length);
  });

  it("never assigns a judge to their own team's submission", () => {
    const submissions = [sub("s1", ["j1"]), sub("s2"), sub("s3"), sub("s4")];
    const judges = ["j1", "j2", "j3"].map((id) => judge(id));

    const plan = planAssignments(submissions, judges, { reviewsPerSubmission: 2 });
    expect(plan.assignments.some((a) => a.judgeId === "j1" && a.submissionId === "s1")).toBe(
      false,
    );
  });

  it("keeps judge workloads balanced", () => {
    const submissions = Array.from({ length: 12 }, (_, i) => sub(`s${i}`));
    const judges = ["j1", "j2", "j3", "j4"].map((id) => judge(id));

    const plan = planAssignments(submissions, judges, { reviewsPerSubmission: 3 });
    const loads = Object.values(plan.loadByJudge);

    expect(Math.max(...loads) - Math.min(...loads)).toBeLessThanOrEqual(1);
  });

  it("does not duplicate assignments a judge already holds", () => {
    const submissions = ["s1", "s2", "s3"].map((id) => sub(id));
    const judges = [judge("j1", ["s1"]), judge("j2"), judge("j3")];

    const plan = planAssignments(submissions, judges, { reviewsPerSubmission: 2 });
    expect(plan.assignments.some((a) => a.judgeId === "j1" && a.submissionId === "s1")).toBe(
      false,
    );
  });

  it("counts existing assignments toward the target", () => {
    const submissions = [sub("s1")];
    const judges = [judge("j1", ["s1"]), judge("j2"), judge("j3")];

    const plan = planAssignments(submissions, judges, { reviewsPerSubmission: 2 });
    // One reviewer already exists, so only one more is needed.
    expect(plan.assignments).toHaveLength(1);
    expect(plan.shortfalls).toHaveLength(0);
  });

  it("reports a shortfall when there are no judges at all", () => {
    const plan = planAssignments([sub("s1")], [], { reviewsPerSubmission: 3 });
    expect(plan.assignments).toHaveLength(0);
    expect(plan.shortfalls).toHaveLength(1);
  });

  it("handles an event with no submissions", () => {
    const plan = planAssignments([], [judge("j1")], { reviewsPerSubmission: 3 });
    expect(plan.assignments).toHaveLength(0);
    expect(plan.shortfalls).toHaveLength(0);
  });

  it("respects an explicit per-judge cap", () => {
    const submissions = Array.from({ length: 10 }, (_, i) => sub(`s${i}`));
    const judges = ["j1", "j2"].map((id) => judge(id));

    const plan = planAssignments(submissions, judges, {
      reviewsPerSubmission: 3,
      maxPerJudge: 5,
    });

    for (const load of Object.values(plan.loadByJudge)) {
      expect(load).toBeLessThanOrEqual(5);
    }
    expect(plan.shortfalls.length).toBeGreaterThan(0);
  });

  it("is deterministic for a given seed", () => {
    const submissions = Array.from({ length: 8 }, (_, i) => sub(`s${i}`));
    const judges = ["j1", "j2", "j3"].map((id) => judge(id));

    const a = planAssignments(submissions, judges, { reviewsPerSubmission: 2, seed: 7 });
    const b = planAssignments(submissions, judges, { reviewsPerSubmission: 2, seed: 7 });

    expect(a.assignments).toEqual(b.assignments);
  });

  it("produces a different queue order for a different seed", () => {
    const submissions = Array.from({ length: 12 }, (_, i) => sub(`s${i}`));
    const judges = ["j1", "j2", "j3"].map((id) => judge(id));

    const a = planAssignments(submissions, judges, { reviewsPerSubmission: 2, seed: 1 });
    const b = planAssignments(submissions, judges, { reviewsPerSubmission: 2, seed: 999 });

    expect(a.assignments).not.toEqual(b.assignments);
  });

  it("gives each judge a contiguous queue position sequence", () => {
    const submissions = Array.from({ length: 9 }, (_, i) => sub(`s${i}`));
    const judges = ["j1", "j2", "j3"].map((id) => judge(id));

    const plan = planAssignments(submissions, judges, { reviewsPerSubmission: 2 });

    for (const j of judges) {
      const positions = plan.assignments
        .filter((a) => a.judgeId === j.id)
        .map((a) => a.position)
        .sort((x, y) => x - y);
      expect(positions).toEqual(positions.map((_, i) => i));
    }
  });
});
