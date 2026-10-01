import "server-only";
import { cache } from "react";
import type { Structure } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";

export type QuestionSettings = { defaultDeadline: string | null; perSubject: number };

/** The school's default question deadline and how many questions are expected per subject and year. */
export const getQuestionSettings = cache(async (): Promise<QuestionSettings> => {
  const supabase = await createClient();
  const { data } = await supabase.from("schools").select("question_deadline, questions_per_subject").maybeSingle();
  return { defaultDeadline: data?.question_deadline ?? null, perSubject: data?.questions_per_subject ?? 40 };
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
  questions: number;
  target: number;
  deadline: string | null;
  done: boolean;
};

/** Upload progress per subject and year group, for one teacher or (admins) everyone they oversee. */
export async function getUploadProgress(s: Structure, teacherId: string | null): Promise<ProgressRow[]> {
  const supabase = await createClient();
  const [settings, { data }] = await Promise.all([
    getQuestionSettings(),
    supabase.rpc("upload_progress", teacherId ? { p_teacher: teacherId } : {}),
  ]);
  type Raw = { teacher_id: string; subject_id: string; year_id: string; approved: boolean; class_ids: string[]; questions: number };
  return ((data ?? []) as Raw[])
    .map((r) => {
      const sectionId = s.subjectById.get(r.subject_id)?.section_id;
      return {
        teacherId: r.teacher_id,
        subjectId: r.subject_id,
        yearId: r.year_id,
        approved: r.approved,
        classIds: r.class_ids,
        questions: r.questions,
        target: settings.perSubject,
        deadline: deadlineForSection(sectionId, s, settings),
        done: r.questions >= settings.perSubject,
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
