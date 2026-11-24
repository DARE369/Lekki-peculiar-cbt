import "server-only";
import { createClient } from "@/lib/supabase/server";
import { parseCalcEvent, type CalcUse } from "@/lib/calculator-log";
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

/** Everything students worked out on the exam calculator for these attempts (only those this user may see — RLS). */
export async function loadCalculatorLog(attemptIds: string[]): Promise<CalcUse[]> {
  const supabase = await createClient();
  const out: CalcUse[] = [];
  for (let i = 0; i < attemptIds.length; i += 100) {
    const chunk = attemptIds.slice(i, i + 100);
    for (let from = 0; ; from += 1000) {
      const { data } = await supabase
        .from("attempt_events")
        .select("attempt_id, detail, created_at")
        .eq("type", "calculator")
        .in("attempt_id", chunk)
        .order("created_at")
        .range(from, from + 999);
      for (const r of data ?? []) {
        const use = parseCalcEvent(r as { attempt_id: string; created_at: string; detail: unknown });
        if (use) out.push(use);
      }
      if (!data || data.length < 1000) break;
    }
  }
  return out;
}

/** How many calculator entries there are (for the tab label), without loading them. */
export async function countCalculatorUses(attemptIds: string[]): Promise<number> {
  if (!attemptIds.length) return 0;
  const supabase = await createClient();
  let total = 0;
  for (let i = 0; i < attemptIds.length; i += 100) {
    const { count } = await supabase
      .from("attempt_events")
      .select("id", { count: "exact", head: true })
      .eq("type", "calculator")
      .in("attempt_id", attemptIds.slice(i, i + 100));
    total += count ?? 0;
  }
  return total;
}

export interface BroadsheetAttempt extends AttemptRow {
  assessments: { id: string; title: string; type: AssessmentType; subject_id: string; term_id: string; sequence_label: string | null; settings: Partial<AssessmentSettings> } | null;
}

/** Submitted attempts for one class in one term (only those this user may see — RLS). */
export async function loadClassAttempts(classId: string, termId: string, sequenceLabel?: string) {
  const supabase = await createClient();
  await supabase.rpc("finalize_expired_attempts");
  let q = supabase
    .from("attempts")
    .select(`${ATTEMPT_COLUMNS}, assessments!inner(id, title, type, subject_id, term_id, sequence_label, settings)`)
    .eq("class_id", classId)
    .eq("status", "submitted")
    .eq("assessments.term_id", termId)
    .order("submitted_at");
  if (sequenceLabel) q = q.eq("assessments.sequence_label", sequenceLabel);
  const { data } = await q;
  return (data ?? []) as unknown as BroadsheetAttempt[];
}
