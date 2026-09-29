export type EventRole = "PARTICIPANT" | "JUDGE" | "ADMIN";

export type EventStatus =
  | "DRAFT"
  | "PUBLISHED"
  | "REGISTRATION_OPEN"
  | "SUBMISSIONS_OPEN"
  | "JUDGING"
  | "VOTING"
  | "RESULTS_PUBLISHED"
  | "ARCHIVED";

export interface User {
  id: string;
  email: string;
  name: string;
  isOrganizer: boolean;
  isSuperAdmin: boolean;
  org: string | null;
  pronouns: string | null;
  bio: string | null;
  link: string | null;
  avatarHue: string;
}

type EventMode = "ONLINE" | "IN_PERSON" | "HYBRID";

export interface EventSummary {
  id: string;
  slug: string;
  name: string;
  tagline: string | null;
  status: EventStatus;
  visibility?: "PUBLIC" | "UNLISTED" | "PRIVATE";
  themeTags: string[];
  logoUrl?: string | null;
  bannerUrl?: string | null;
  submissionDeadline: string | null;
  submissionsOpenAt?: string | null;
  registrationClosesAt?: string | null;
  judgingClosesAt?: string | null;
  votingClosesAt?: string | null;
  mode?: EventMode;
  place?: string | null;
  eligibility?: string;
  minTeamSize?: number;
  maxTeamSize?: number;
  resultsPublished?: boolean;
  prizePoolCents?: number;
  currency?: string;
  owner?: { name: string; org: string | null };
  _count?: { submissions: number; memberships: number; teams?: number };
}

export interface Track {
  id: string;
  name: string;
  slug: string;
  description: string | null;
}

interface Prize {
  id: string;
  title: string;
  description: string | null;
  amountCents: number | null;
  currency: string;
  track: { id: string; name: string } | null;
}

export interface CustomQuestion {
  id: string;
  stage?: "REGISTRATION" | "SUBMISSION";
  prompt: string;
  helpText: string | null;
  type?: QuestionType;
  options?: string[];
  required: boolean;
  publicAnswer: boolean;
}

export type QuestionType = "SHORT_TEXT" | "LONG_TEXT" | "URL" | "SELECT" | "MULTI_SELECT" | "BOOLEAN";

/** Standard registration fields an organizer sets to required, optional or not asked. */
export type RegistrationField = "org" | "currentRole" | "track" | "experience" | "skills";
export type FieldRule = "required" | "optional" | "off";

export interface EventPerson {
  id: string;
  kind: "SPEAKER" | "MENTOR";
  name: string;
  role: string;
  org: string | null;
}

export interface Partner {
  id: string;
  name: string;
  tier: string;
}

export interface Challenge {
  id: string;
  sponsor: string;
  name: string;
  brief: string;
  amountCents: number | null;
  currency: string;
  tags: string[];
  entries: number;
}

export interface Comment {
  id: string;
  body: string;
  hiddenAt: string | null;
  hiddenReason: string | null;
  createdAt: string;
  user: { id: string; name: string; avatarHue: string };
}

/** What the signed-in viewer may do here, as decided by the server. */
interface Viewer {
  roles: EventRole[];
  isOwner: boolean;
  isEventAdmin: boolean;
  fullAccess?: boolean;
  permissions?: string[];
  isJudge: boolean;
  isParticipant: boolean;
}

export interface EventDetail extends EventSummary {
  description: string | null;
  registrationFields?: Partial<Record<RegistrationField, FieldRule>>;
  eligibility: string;
  minTeamSize: number;
  maxTeamSize: number;
  reviewsPerSubmission: number;
  resultsPublished: boolean;
  registrationOpensAt: string | null;
  registrationClosesAt: string | null;
  submissionsOpenAt: string | null;
  judgingOpensAt: string | null;
  judgingClosesAt: string | null;
  votingOpensAt: string | null;
  votingClosesAt: string | null;
  tracks: Track[];
  prizes: Prize[];
  customQuestions: CustomQuestion[];
  owner: { id: string; name: string; org: string | null };
  viewer: Viewer;
}

export interface SubmissionCard {
  id: string;
  name: string;
  tagline: string | null;
  thumbnailUrl: string | null;
  techTags: string[];
  repoUrl: string | null;
  liveUrl: string | null;
  videoUrl: string | null;
  submittedAt: string | null;
  track: { id: string; name: string; slug: string } | null;
  team: { id: string; name: string };
}

export interface Paginated<T> {
  items: T[];
  total: number;
  take: number;
  skip: number;
}

export interface DeadlineWindow {
  open: boolean;
  reason?: string;
  deadline: string | null;
  msRemaining: number | null;
}

interface TeamMemberView {
  id: string;
  role: "OWNER" | "MEMBER";
  userId: string;
  user: { id: string; name: string; org: string | null; avatarHue: string };
}

export interface Team {
  id: string;
  name: string;
  pitch: string | null;
  lookingForMembers: boolean;
  members: TeamMemberView[];
  submission: { id: string; name: string; status: string } | null;
}

export interface Submission {
  id: string;
  name: string;
  tagline: string | null;
  description: string | null;
  thumbnailUrl: string | null;
  repoUrl: string | null;
  liveUrl: string | null;
  videoUrl: string | null;
  techTags: string[];
  challengeIds: string[];
  license: string | null;
  status: "DRAFT" | "SUBMITTED" | "WITHDRAWN" | "DISQUALIFIED";
  submittedAt: string | null;
  lockedAt: string | null;
  flagReason?: string | null;
  flaggedAt?: string | null;
  declarations: Record<string, boolean>;
  images: Array<{ id: string; url: string; caption: string | null }>;
  track: { id: string; name: string; slug: string } | null;
  team: { id: string; name: string };
  answers: Array<{ questionId: string; value: string; question: CustomQuestion }>;
}

export interface MyEventRow {
  event: EventSummary;
  roles: string[];
}

export interface SessionResponse {
  user: User | null;
  events: MyEventRow[];
}
