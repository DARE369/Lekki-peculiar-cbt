import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { AttemptRow, PaperQuestion } from "@/lib/reports";
import { DEFAULT_SETTINGS, type AssessmentSettings, type AssessmentType } from "@/lib/types";

export const ATTEMPT_COLUMNS =
  "id, student_id, class_id, assessment_id, status, score, max_score, correct_count, answered_count, total_questions, started_at, submitted_at, is_makeup, focus_losses, relogins, late_sync, login_method, question_order";

export interface StudentLite {
  id: string;
  admission_no: string;
  first_name: string;
  last_name: string;
  other_names: string | null;
  class_id: string | null;
  photo_path: string | null;
}

export async function loadAssessmentReport(id: string, classId?: string) {
  const supabase = await createClient();
  await supabase.rpc("finalize_expired_attempts");
  const { data: a } = await supabase
    .from("assessments")
    .select("id, title, type, subject_id, year_id, term_id, question_count, duration_minutes, settings, paper, created_by, status")
    .eq("id", id)
    .maybeSingle();
  if (!a) return null;
  let q = supabase.from("attempts").select(ATTEMPT_COLUMNS).eq("assessment_id", id).eq("status", "submitted");
  if (classId) q = q.eq("class_id", classId);
  const { data: attempts } = await q;
  const rows = (attempts ?? []) as AttemptRow[];
  const ids = rows.map((r) => r.id);
  const studentIds = [...new Set(rows.map((r) => r.student_id))];
  const [{ data: answers }, { data: students }, { data: windows }] = await Promise.all([
    ids.length
      ? supabase.from("attempt_answers").select("attempt_id, question_id, selected").in("attempt_id", ids)
      : Promise.resolve({ data: [] as { attempt_id: string; question_id: string; selected: string | null }[] }),
    studentIds.length
      ? supabase.from("students").select("id, admission_no, first_name, last_name, other_names, class_id, photo_path").in("id", studentIds)
      : Promise.resolve({ data: [] as StudentLite[] }),
    supabase.from("exam_windows").select("id, class_id").eq("assessment_id", id),
  ]);
  const settings: AssessmentSettings = { ...DEFAULT_SETTINGS, ...(a.settings ?? {}) };
  return {
    assessment: { ...a, type: a.type as AssessmentType, settings },
    questions: ((a.paper?.questions ?? []) as PaperQuestion[]),
    attempts: rows,
    answers: answers ?? [],
    students: new Map(((students ?? []) as StudentLite[]).map((s) => [s.id, s])),
    classIds: [...new Set((windows ?? []).map((w) => w.class_id as string))],
  };
}

export interface BroadsheetAttempt extends AttemptRow {
  assessments: { id: string; title: string; type: AssessmentType; subject_id: string; term_id: string; settings: Partial<AssessmentSettings> } | null;
}

/** Submitted attempts for one class in one term (only those this user may see — RLS). */
export async function loadClassAttempts(classId: string, termId: string) {
  const supabase = await createClient();
  await supabase.rpc("finalize_expired_attempts");
  const { data } = await supabase
    .from("attempts")
    .select(`${ATTEMPT_COLUMNS}, assessments!inner(id, title, type, subject_id, term_id, settings)`)
    .eq("class_id", classId)
    .eq("status", "submitted")
    .eq("assessments.term_id", termId)
    .order("submitted_at");
  return (data ?? []) as unknown as BroadsheetAttempt[];
}
