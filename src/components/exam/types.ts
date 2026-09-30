export interface StudentCard {
  id: string;
  name: string;
  first_name: string;
  class_name: string;
  photo_url: string | null;
}

export interface AvailableExam {
  window_id: string;
  title: string;
  type: string;
  subject: string;
  duration_minutes: number;
  question_count: number;
  instructions: string | null;
  starts_at: string;
  ends_at: string;
  is_makeup: boolean;
  state: "scheduled" | "awaiting_start" | "live" | "paused" | "closed";
  attempt_status: "in_progress" | "submitted" | null;
}

export interface ExamQuestion {
  id: string;
  body: string;
  image_url: string | null;
  options: { key: string; text: string }[];
}

export interface ExamSettings {
  require_all_answered?: boolean;
  allow_flag?: boolean;
  allow_back?: boolean;
  show_result?: "none" | "score" | "full";
  instructions?: string;
}

export interface ExamResult {
  status: "submitted" | "voided" | "in_progress";
  show: "none" | "score" | "full";
  score?: number;
  max_score?: number;
  correct?: number;
  answered?: number;
  total?: number;
  review?: { q: string; s: string | null; a: string }[] | null;
}

export interface LocalAnswer {
  s: string | null;
  f: boolean;
  at: string;
}

export interface LocalAttempt {
  version: 1;
  token: string;
  attemptId: string;
  student: StudentCard;
  assessment: {
    title: string;
    type: string;
    subject: string;
    duration_minutes: number;
    question_count: number;
    settings: ExamSettings;
  };
  questions: ExamQuestion[];
  deadline: string;
  offsetMs: number;
  answers: Record<string, LocalAnswer>;
  dirty: string[];
  events: { type: string; at: string; detail?: Record<string, unknown> }[];
  current: number;
  sealed: null | { source: "student" | "timeout"; at: string };
  result: ExamResult | null;
  lastSyncAt: string | null;
  lastError: string | null;
}
