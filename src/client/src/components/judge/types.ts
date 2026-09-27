export interface Criterion {
  id: string;
  key: string;
  label: string;
  hint: string | null;
  weight: number;
  minScore: number;
  maxScore: number;
}

export interface MyScore {
  weightedTotal: number;
  comment: string | null;
  criteria: Array<{ criterionId: string; value: number }>;
}

export interface QueueItem {
  assignmentId: string;
  position: number;
  skippedAt: string | null;
  submission: {
    id: string;
    name: string;
    tagline: string | null;
    description: string | null;
    thumbnailUrl: string | null;
    repoUrl: string | null;
    liveUrl: string | null;
    videoUrl: string | null;
    techTags: string[];
    track: { id: string; name: string } | null;
    answers: Array<{ value: string; question: { prompt: string } }>;
  };
  myScore: MyScore | null;
}

export interface Queue {
  window: { open: boolean; reason?: string };
  total: number;
  completed: number;
  items: QueueItem[];
}

export interface SignedRecord {
  payload: {
    issuedAt: string;
    event: { name: string };
    counts: { assigned: number; scored: number; skipped: number };
  };
  signature: string;
  hash: string;
  key: { algorithm: string; publicKey: string };
}

interface RankingGroup {
  key: string;
  submissions: Array<{
    id: string;
    name: string;
    tagline: string | null;
    track: { id: string; name: string } | null;
    team: { id: string; name: string };
  }>;
  ranking: string[] | null;
  skipped: boolean;
}

export interface GroupsResponse {
  mode: "COMPARATIVE";
  groupSize: number;
  total: number;
  completed: number;
  groups: RankingGroup[];
}

export interface BordaStandings {
  method: "BORDA";
  rankings: number;
  standings: Array<{
    submissionId: string;
    points: number;
    appearances: number;
    firsts: number;
    score: number;
    rank: number;
    submission: { id: string; name: string } | null;
  }>;
}

/** What a judge has entered for one project on this device. */
export interface Draft {
  scores: Record<string, number>;
  comment: string;
}

/** Where a project stands for this judge. */
export type ItemState = "submitted" | "edited" | "draft" | "skipped" | "pending";

export const STATE_LABEL: Record<ItemState, string> = {
  submitted: "Submitted",
  edited: "Changed, not resubmitted",
  draft: "Draft, not submitted",
  skipped: "Skipped",
  pending: "Not started",
};

export function scoresOf(score: MyScore | null): Record<string, number> {
  const out: Record<string, number> = {};
  for (const entry of score?.criteria ?? []) out[entry.criterionId] = entry.value;
  return out;
}

export function sameAsServer(draft: Draft, score: MyScore | null): boolean {
  const server = scoresOf(score);
  const keys = new Set([...Object.keys(server), ...Object.keys(draft.scores)]);
  for (const key of keys) if (server[key] !== draft.scores[key]) return false;
  return draft.comment.trim() === (score?.comment ?? "").trim();
}

export function stateOf(item: QueueItem, draft: Draft | undefined): ItemState {
  if (item.myScore) return draft && !sameAsServer(draft, item.myScore) ? "edited" : "submitted";
  if (draft && (Object.keys(draft.scores).length > 0 || draft.comment.trim())) return "draft";
  return item.skippedAt ? "skipped" : "pending";
}
