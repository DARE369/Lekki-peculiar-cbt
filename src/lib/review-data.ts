import "server-only";
import type { Structure } from "@/lib/data";
import { checkContent, checkLive, overlapPercent, type ClassReadiness, type Issue, type QuestionFacts, type Verdict } from "@/lib/readiness";
import { createClient } from "@/lib/supabase/server";
import { DEFAULT_SETTINGS, type AssessmentSettings } from "@/lib/types";

export interface ReviewTest {
  id: string;
  title: string;
  type: string;
  status: "pending_approval" | "approved" | "changes_requested";
  subjectId: string;
  yearId: string;
  /** The class arms the test is for. */
  classIds: string[];
  teacherId: string;
  teacherName: string;
  questionCount: number;
  poolSize: number;
  durationMinutes: number;
  submittedAt: string | null;
  reviewNote: string | null;
  flag: {
    status: "open" | "resolved";
    category: string | null;
    note: string | null;
    flaggedAt: string | null;
    amending: boolean;
    correctionsSubmittedAt: string | null;
  } | null;
  /** Only for tests awaiting approval. */
  verdict: Verdict | null;
  issues: Issue[];
  live: ClassReadiness[];
  windows: { classId: string; startsAt: string }[];
}

/** PostgREST returns at most 1000 rows per request, so read big tables page by page. */
async function pages<T>(run: (from: number, to: number) => PromiseLike<{ data: T[] | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data } = await run(from, from + 999);
    out.push(...(data ?? []));
    if ((data?.length ?? 0) < 1000) break;
  }
  return out;
}
const chunks = <T,>(list: T[], n: number) => Array.from({ length: Math.ceil(list.length / n) }, (_, i) => list.slice(i * n, i * n + n));
const lagosDay = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Lagos" }).format(new Date(iso));

/**
 * Every pending, approved or sent-back test of the current term that the signed-in person may see
 * (row-level security limits Heads of Section to their section), with its readiness checks.
 */
export async function loadReviewTests(s: Structure): Promise<ReviewTest[]> {
  const supabase = await createClient();
  const termId = s.currentTerm?.id;
  if (!termId) return [];

  const { data: rows } = await supabase
    .from("assessments")
    .select(
      "id, title, type, status, subject_id, year_id, class_ids, question_count, duration_minutes, created_by, submitted_at, review_note, settings, flag_status, flag_category, flag_note, flagged_at, amending, corrections_submitted_at, staff:created_by(full_name)",
    )
    .eq("term_id", termId)
    .in("status", ["pending_approval", "approved", "changes_requested"])
    .order("submitted_at", { ascending: true, nullsFirst: false })
    .limit(1000);
  type Row = {
    id: string;
    title: string;
    type: string;
    status: ReviewTest["status"];
    subject_id: string;
    year_id: string;
    class_ids: string[] | null;
    question_count: number;
    duration_minutes: number;
    created_by: string;
    submitted_at: string | null;
    review_note: string | null;
    settings: Partial<AssessmentSettings> | null;
    flag_status: "open" | "resolved" | null;
    flag_category: string | null;
    flag_note: string | null;
    flagged_at: string | null;
    amending: boolean | null;
    corrections_submitted_at: string | null;
    staff: { full_name: string } | null;
  };
  const tests = (rows ?? []) as unknown as Row[];
  if (tests.length === 0) return [];
  const ids = tests.map((t) => t.id);

  // Question links for every test (ids only, for overlap), and question text for the ones awaiting approval.
  const links = (
    await Promise.all(
      chunks(ids, 100).map((part) => pages<{ assessment_id: string; question_id: string }>((a, b) => supabase.from("assessment_questions").select("assessment_id, question_id").in("assessment_id", part).range(a, b))),
    )
  ).flat();
  const byTest = new Map<string, string[]>();
  for (const l of links) byTest.set(l.assessment_id, [...(byTest.get(l.assessment_id) ?? []), l.question_id]);
  const pendingIds = new Set(tests.filter((t) => t.status === "pending_approval").map((t) => t.id));
  const needed = [...new Set(links.filter((l) => pendingIds.has(l.assessment_id)).map((l) => l.question_id))];
  const questionRows = (
    await Promise.all(chunks(needed, 150).map(async (part) => (await supabase.from("questions").select("id, body, options, answer, topic").in("id", part)).data ?? []))
  ).flat() as unknown as QuestionFacts[];
  const question = new Map(questionRows.map((q) => [q.id, q]));

  // Students per class, windows, and which classes each teacher is approved for.
  const classIdsInScope = new Set<string>();
  const armsOf = (t: Row) => {
    const picked = (t.class_ids ?? []).filter((c) => s.classById.get(c)?.active);
    return picked.length ? picked : s.classes.filter((c) => c.active && c.year_id === t.year_id).map((c) => c.id);
  };
  for (const t of tests) for (const c of armsOf(t)) classIdsInScope.add(c);
  const [students, windows, assignments] = await Promise.all([
    pages<{ class_id: string | null; photo_path: string | null }>((a, b) => supabase.from("students").select("class_id, photo_path").eq("active", true).range(a, b)),
    pages<{ assessment_id: string; class_id: string; starts_at: string }>((a, b) => supabase.from("exam_windows").select("assessment_id, class_id, starts_at").range(a, b)),
    pages<{ teacher_id: string; subject_id: string; class_id: string }>((a, b) =>
      supabase.from("teaching_assignments").select("teacher_id, subject_id, class_id").eq("status", "approved").eq("session_id", s.currentSessionId ?? "").range(a, b),
    ),
  ]);
  const headcount = new Map<string, { n: number; noPhoto: number }>();
  for (const st of students) {
    if (!st.class_id) continue;
    const h = headcount.get(st.class_id) ?? { n: 0, noPhoto: 0 };
    h.n += 1;
    if (!st.photo_path) h.noPhoto += 1;
    headcount.set(st.class_id, h);
  }
  const approvedFor = new Map<string, Set<string>>();
  for (const a of assignments) {
    const k = `${a.teacher_id}:${a.subject_id}`;
    approvedFor.set(k, (approvedFor.get(k) ?? new Set()).add(a.class_id));
  }
  const windowsByClassDay = new Map<string, number>();
  for (const w of windows) windowsByClassDay.set(`${w.class_id}:${lagosDay(w.starts_at)}`, (windowsByClassDay.get(`${w.class_id}:${lagosDay(w.starts_at)}`) ?? 0) + 1);

  return tests.map((t) => {
    const arms = armsOf(t);
    const mine = windows.filter((w) => w.assessment_id === t.id);
    const live = checkLive(
      arms.map((c) => {
        const w = mine.find((x) => x.class_id === c);
        const day = w ? lagosDay(w.starts_at) : null;
        return {
          id: c,
          name: s.className(c),
          students: headcount.get(c)?.n ?? 0,
          studentsWithoutPhoto: headcount.get(c)?.noPhoto ?? 0,
          scheduledDay: day,
          otherWindowsThatDay: day ? (windowsByClassDay.get(`${c}:${day}`) ?? 1) - 1 : 0,
        };
      }),
      approvedFor.get(`${t.created_by}:${t.subject_id}`) ?? new Set(),
    );

    let verdict: Verdict | null = null;
    let issues: Issue[] = [];
    const qids = byTest.get(t.id) ?? [];
    if (t.status === "pending_approval") {
      const others = new Set<string>();
      for (const o of tests) {
        if (o.id !== t.id && o.subject_id === t.subject_id && o.year_id === t.year_id) for (const id of byTest.get(o.id) ?? []) others.add(id);
      }
      const questions = qids.map((id) => question.get(id)).filter((q): q is QuestionFacts => Boolean(q));
      const r = checkContent({
        type: t.type,
        questionCount: t.question_count,
        durationMinutes: t.duration_minutes,
        settings: { show_result: { ...DEFAULT_SETTINGS, ...(t.settings ?? {}) }.show_result },
        questions,
        overlapPercent: overlapPercent(qids, others),
      });
      verdict = r.verdict;
      issues = r.issues;
    }
    return {
      id: t.id,
      title: t.title,
      type: t.type,
      status: t.status,
      subjectId: t.subject_id,
      yearId: t.year_id,
      classIds: arms,
      teacherId: t.created_by,
      teacherName: t.staff?.full_name ?? "—",
      questionCount: t.question_count,
      poolSize: qids.length,
      durationMinutes: t.duration_minutes,
      submittedAt: t.submitted_at,
      reviewNote: t.review_note,
      flag: t.flag_status
        ? { status: t.flag_status, category: t.flag_category, note: t.flag_note, flaggedAt: t.flagged_at, amending: Boolean(t.amending), correctionsSubmittedAt: t.corrections_submitted_at }
        : null,
      verdict,
      issues,
      live,
      windows: mine.map((w) => ({ classId: w.class_id, startsAt: w.starts_at })),
    };
  });
}
