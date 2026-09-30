import type { AssessmentStatus, AssessmentType, WindowState } from "@/lib/types";

type Tone = "neutral" | "brand" | "success" | "warning" | "danger" | "info";

export const STATUS_LABEL: Record<AssessmentStatus, [string, Tone]> = {
  draft: ["Draft", "neutral"],
  pending_approval: ["Awaiting approval", "warning"],
  changes_requested: ["Changes requested", "danger"],
  approved: ["Approved", "success"],
  archived: ["Archived", "neutral"],
};

export const WINDOW_LABEL: Record<WindowState, [string, Tone]> = {
  scheduled: ["Scheduled", "info"],
  awaiting_start: ["Waiting for admin to start", "warning"],
  live: ["Live", "success"],
  paused: ["Paused", "warning"],
  closed: ["Closed", "neutral"],
};

export const TYPE_LABEL: Record<AssessmentType, string> = {
  test: "Test",
  exam: "Exam",
  mock: "Mock",
  practice: "Practice",
};

/** Same rules as public.window_state() in SQL, for rendering lists without a round trip. */
export function windowState(
  w: { status: string; starts_at: string; ends_at: string; auto_start: boolean },
  now = Date.now(),
): WindowState {
  const start = Date.parse(w.starts_at);
  const end = Date.parse(w.ends_at);
  if (w.status === "closed" || now > end) return "closed";
  if (w.status === "paused") return "paused";
  if (w.status === "live") return "live";
  if (now < start) return "scheduled";
  return w.auto_start ? "live" : "awaiting_start";
}
