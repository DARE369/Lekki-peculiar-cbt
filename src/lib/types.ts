export type StaffRole = "super_admin" | "admin" | "teacher";
export type AssessmentType = "test" | "exam" | "mock_test" | "mock" | "practice";
export type AssessmentStatus = "draft" | "pending_approval" | "changes_requested" | "approved" | "archived";
export type WindowState = "scheduled" | "awaiting_start" | "live" | "paused" | "closed";
export type AttemptStatus = "in_progress" | "submitted" | "voided";

export const PERMISSIONS = {
  "exam.approve": "Approve assessments & schedule exams",
  "exam.start": "Start / pause / close exams",
  "exam.extend_time": "Give extra time",
  "exam.grant_makeup": "Grant make-up exams",
  "attempt.unlock": "Unlock re-login on another computer",
  "attempt.void": "Void attempts",
  "students.manage": "Manage students & photos",
  "teachers.manage": "Approve teaching assignments",
  "terminals.manage": "Register lab computers",
} as const;
export type Permission = keyof typeof PERMISSIONS;

/** What a new Head of Section gets by default. Make-ups and voiding stay off until granted. */
export const HOD_DEFAULT_PERMISSIONS: Permission[] = [
  "exam.approve",
  "exam.start",
  "exam.extend_time",
  "attempt.unlock",
  "students.manage",
  "teachers.manage",
  "terminals.manage",
];

export interface Section {
  id: string;
  code: string;
  name: string;
  cbt_enabled: boolean;
  logo_url: string | null;
  sort: number;
  /** Overrides the school's question deadline for this section's subjects. */
  question_deadline: string | null;
}
export interface Year {
  id: string;
  section_id: string;
  name: string;
  level: number;
  stage: "junior" | "senior" | null;
}
export interface ClassRow {
  id: string;
  year_id: string;
  name: string;
  track_id: string | null;
  active: boolean;
}
export interface Subject {
  id: string;
  section_id: string;
  name: string;
  code: string | null;
  active: boolean;
}
export interface Term {
  id: string;
  session_id: string;
  name: string;
  ordinal: number;
  is_current: boolean;
}

export interface AssessmentSettings {
  shuffle_questions: boolean;
  shuffle_options: boolean;
  require_all_answered: boolean;
  allow_flag: boolean;
  allow_back: boolean;
  show_result: "none" | "score" | "full";
  pass_mark: number;
  /** "per_question": each question is worth marks_per_question; "total": the whole test is out of total_marks */
  marks_mode?: "per_question" | "total";
  marks_per_question: number;
  total_marks?: number | null;
  instructions: string;
}

export const DEFAULT_SETTINGS: AssessmentSettings = {
  shuffle_questions: true,
  shuffle_options: true,
  require_all_answered: false,
  allow_flag: true,
  allow_back: true,
  show_result: "score",
  pass_mark: 50,
  marks_mode: "per_question",
  marks_per_question: 1,
  total_marks: null,
  instructions: "Answer all questions.",
};

export const TYPE_DEFAULTS: Record<AssessmentType, { questions: number; minutes: number; label: string }> = {
  test: { questions: 20, minutes: 30, label: "Test" },
  exam: { questions: 40, minutes: 60, label: "Exam" },
  mock_test: { questions: 20, minutes: 30, label: "Test mock" },
  mock: { questions: 40, minutes: 60, label: "Exam mock" },
  practice: { questions: 20, minutes: 30, label: "Practice" },
};

export interface QuestionOption {
  key: string;
  text: string;
}

/** What a test is marked out of, and what each question is worth (for display; grading uses the same rule). */
export function markingSummary(settings: Pick<AssessmentSettings, "marks_mode" | "marks_per_question" | "total_marks">, questions: number) {
  const round1 = (n: number) => Math.round(n * 10) / 10;
  if (settings.marks_mode === "total" && settings.total_marks) {
    return { outOf: round1(settings.total_marks), perQuestion: questions ? round1(settings.total_marks / questions) : 0, mode: "total" as const };
  }
  const per = settings.marks_per_question || 1;
  return { outOf: round1(per * questions), perQuestion: per, mode: "per_question" as const };
}
