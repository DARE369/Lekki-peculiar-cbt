import "server-only";
import { cache } from "react";
import type { Structure } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";

export type QuestionSettings = { defaultDeadline: string | null };

/** The school's default deadline for uploading questions and building tests. */
export const getQuestionSettings = cache(async (): Promise<QuestionSettings> => {
  const supabase = await createClient();
  const { data } = await supabase.from("schools").select("question_deadline").maybeSingle();
  return { defaultDeadline: data?.question_deadline ?? null };
});

/** A section's deadline if set (e.g. College), otherwise the school's default. ISO date (YYYY-MM-DD) or null. */
export function deadlineForSection(sectionId: string | undefined, s: Structure, settings: QuestionSettings): string | null {
  const own = sectionId ? s.sectionById.get(sectionId)?.question_deadline : null;
  return own ?? settings.defaultDeadline;
}

export type ProgressRow = {
  teacherId: string;
  subjectId: string;
  yearId: string;
  approved: boolean;
  classIds: string[];
  /** Questions this teacher has in the bank for this subject and year group. */
  questions: number;
  /** Tests/exams they've started (drafts) and sent for approval or had approved. */
  testsDraft: number;
  testsSubmitted: number;
  deadline: string | null;
};

/** Progress per subject and year group, for one teacher or (admins) everyone they oversee. No fixed target. */
export async function getUploadProgress(s: Structure, teacherId: string | null): Promise<ProgressRow[]> {
  const supabase = await createClient();
  let tests = supabase.from("assessments").select("created_by, subject_id, year_id, status").eq("term_id", s.currentTerm?.id ?? "");
  if (teacherId) tests = tests.eq("created_by", teacherId);
  const [settings, { data }, { data: testRows }] = await Promise.all([
    getQuestionSettings(),
    supabase.rpc("upload_progress", teacherId ? { p_teacher: teacherId } : {}),
    tests,
  ]);
  const testCount = new Map<string, { draft: number; submitted: number }>();
  for (const t of (testRows ?? []) as { created_by: string; subject_id: string; year_id: string; status: string }[]) {
    const k = `${t.created_by}:${t.subject_id}:${t.year_id}`;
    const c = testCount.get(k) ?? { draft: 0, submitted: 0 };
    if (t.status === "pending_approval" || t.status === "approved") c.submitted += 1;
    else c.draft += 1;
    testCount.set(k, c);
  }
  type Raw = { teacher_id: string; subject_id: string; year_id: string; approved: boolean; class_ids: string[]; questions: number };
  return ((data ?? []) as Raw[])
    .map((r) => {
      const c = testCount.get(`${r.teacher_id}:${r.subject_id}:${r.year_id}`);
      return {
        teacherId: r.teacher_id,
        subjectId: r.subject_id,
        yearId: r.year_id,
        approved: r.approved,
        classIds: r.class_ids,
        questions: r.questions,
        testsDraft: c?.draft ?? 0,
        testsSubmitted: c?.submitted ?? 0,
        deadline: deadlineForSection(s.subjectById.get(r.subject_id)?.section_id, s, settings),
      };
    })
    .sort(
      (a, b) =>
        (s.yearById.get(a.yearId)?.level ?? 0) - (s.yearById.get(b.yearId)?.level ?? 0) ||
        (s.subjectById.get(a.subjectId)?.name ?? "").localeCompare(s.subjectById.get(b.subjectId)?.name ?? ""),
    );
}

/** "Friday 24 October" style date, Lagos time. */
export function formatDeadline(iso: string) {
  return new Date(`${iso}T12:00:00+01:00`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "Africa/Lagos" });
}

/** Whole days from today (Lagos) until the date; negative when it has passed. */
export function daysUntil(iso: string) {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Lagos" });
  return Math.round((Date.parse(`${iso}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
}
