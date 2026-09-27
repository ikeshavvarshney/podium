import type { EventSummary } from "@/lib/types";

/** Where an event sits for one person: something to do now, waiting on others, or finished. */
export type Phase = "act" | "wait" | "done";

export interface Step {
  phase: Phase;
  /** The one fact the person needs now. */
  sentence: string;
  /** The deadline this step is counting toward, with the time left when known. */
  deadline: string | null;
  /** Under two days to go with something still to do. */
  urgent: boolean;
  action: { label: string; href: string };
}

/** What the per-event fetches learned. `loaded` is false until they settle. */
export interface StepData {
  loaded: boolean;
  team: { members: number } | null;
  submission: { status: string } | null;
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** "22h 10m" inside two days, "3 days" beyond, so a same-day deadline is never rounded up. */
export function timeLeft(ms: number): string {
  if (ms <= 0) return "now";
  const hours = Math.floor(ms / HOUR);
  if (hours < 48) {
    const minutes = Math.floor((ms % HOUR) / 60_000);
    return hours > 0 ? `${hours}h ${minutes}m` : `${Math.max(1, minutes)}m`;
  }
  return `${Math.floor(ms / DAY)} days`;
}

/** A deadline to the minute, in the viewer's zone, because these are decided to the hour. */
export function formatDeadline(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

function deadlineLine(label: string, iso: string | null, now: number | null): string | null {
  if (!iso) return null;
  const at = new Date(iso).getTime();
  const when = formatDeadline(iso);
  if (now === null) return `${label} ${when}`;
  return at > now ? `${label} ${when}, in ${timeLeft(at - now)}` : `${label} ${when}`;
}

function participantStep(event: EventSummary, data: StepData, now: number | null): Step {
  const base = `/events/${event.slug}`;
  const submit = { label: "Open my submission", href: `${base}/submit` };
  const team = { label: "Open my team", href: `${base}/teams` };
  const submitted = data.submission?.status === "SUBMITTED";
  const deadlineAt = event.submissionDeadline ? new Date(event.submissionDeadline).getTime() : null;
  const opensAt = event.submissionsOpenAt ? new Date(event.submissionsOpenAt).getTime() : null;

  if (event.status === "RESULTS_PUBLISHED" || event.status === "ARCHIVED" || event.resultsPublished) {
    return {
      phase: "done",
      sentence: event.resultsPublished ? "Results are published." : "This event has ended.",
      deadline: null,
      urgent: false,
      action: event.resultsPublished ? { label: "See how you placed", href: `${base}/winners` } : submit,
    };
  }

  if (event.status === "JUDGING" || event.status === "VOTING") {
    const sentence = submitted
      ? event.status === "JUDGING"
        ? "Your submission is in. Judging is under way."
        : "Your submission is in. Community voting is open."
      : data.loaded
        ? data.submission
          ? "Submissions closed. Your draft was never submitted."
          : "Submissions closed and no submission was sent in."
        : "Submissions have closed.";
    return { phase: "wait", sentence, deadline: null, urgent: false, action: { ...submit, label: "View my submission" } };
  }

  if (data.submission?.status === "DISQUALIFIED") {
    return {
      phase: "wait",
      sentence: "Your submission was disqualified. Ask the organizer if you think this is a mistake.",
      deadline: null,
      urgent: false,
      action: submit,
    };
  }

  if (opensAt !== null && now !== null && opensAt > now && !data.submission) {
    return {
      phase: "wait",
      sentence: `Submissions open ${formatDeadline(event.submissionsOpenAt!)}. Get your team together before then.`,
      deadline: null,
      urgent: false,
      action: team,
    };
  }

  const closed = deadlineAt !== null && now !== null && deadlineAt <= now;
  if (closed) {
    return {
      phase: "wait",
      sentence: submitted ? "Submissions have closed. Your submission is in." : "Submissions have closed.",
      deadline: null,
      urgent: false,
      action: { ...submit, label: "View my submission" },
    };
  }

  const deadline = deadlineLine("Submissions close", event.submissionDeadline, now);
  const urgent = deadlineAt !== null && now !== null && deadlineAt - now < 2 * DAY && !submitted;

  if (submitted) {
    return {
      phase: "wait",
      sentence: "Your submission is in. You can keep editing until the deadline.",
      deadline,
      urgent: false,
      action: { ...submit, label: "Review my submission" },
    };
  }

  const min = event.minTeamSize ?? 1;
  const members = data.team?.members ?? 0;
  let sentence: string;
  let action = submit;
  if (!data.loaded) {
    sentence = "Checking your team and submission.";
  } else if (!data.team) {
    sentence = "You are not on a team yet.";
    action = team;
  } else if (data.submission?.status === "DRAFT") {
    sentence = "Your draft is saved but not submitted.";
    action = { ...submit, label: "Finish and submit" };
  } else {
    sentence = "You have not started your submission.";
    action = { ...submit, label: "Start my submission" };
  }
  if (data.loaded && data.team && members < min) {
    sentence += ` Your team has ${members} of ${min} members.`;
  }
  return { phase: "act", sentence, deadline, urgent, action };
}

function judgeStep(event: EventSummary, now: number | null): Step {
  const base = `/events/${event.slug}`;
  const closes = event.judgingClosesAt ? new Date(event.judgingClosesAt).getTime() : null;
  if (event.status === "JUDGING") {
    return {
      phase: "act",
      sentence: "Projects are waiting in your scoring queue.",
      deadline: deadlineLine("Judging closes", event.judgingClosesAt ?? null, now),
      urgent: closes !== null && now !== null && closes > now && closes - now < 2 * DAY,
      action: { label: "Open scoring queue", href: `${base}/judge` },
    };
  }
  if (event.status === "RESULTS_PUBLISHED" || event.status === "ARCHIVED") {
    return {
      phase: "done",
      sentence: "Judging is finished.",
      deadline: null,
      urgent: false,
      action: { label: "See the results", href: `${base}/winners` },
    };
  }
  return {
    phase: "wait",
    sentence: "Judging has not started. Your queue opens with the judging round.",
    deadline: null,
    urgent: false,
    action: { label: "Open scoring queue", href: `${base}/judge` },
  };
}

function adminStep(event: EventSummary): Step {
  const base = `/events/${event.slug}`;
  const finished = event.status === "RESULTS_PUBLISHED" || event.status === "ARCHIVED";
  return {
    phase: finished ? "done" : "wait",
    sentence: finished ? "You ran this event. Results are out." : "You run this event.",
    deadline: null,
    urgent: false,
    action: { label: "Open the dashboard", href: `${base}/manage` },
  };
}

/**
 * The one thing this person should know and do for this event. A participant
 * role wins over a judge role, which wins over running the event, because
 * the participant's deadline is the one that costs them the most to miss.
 */
export function stepFor(event: EventSummary, roles: string[], data: StepData, now: number | null): Step {
  if (roles.includes("PARTICIPANT")) return participantStep(event, data, now);
  if (roles.includes("JUDGE")) return judgeStep(event, now);
  return adminStep(event);
}

/** Events still worth fetching a team and submission for. */
export function needsStatusFetch(event: EventSummary, roles: string[]): boolean {
  return roles.includes("PARTICIPANT") && !["DRAFT", "RESULTS_PUBLISHED", "ARCHIVED"].includes(event.status);
}
