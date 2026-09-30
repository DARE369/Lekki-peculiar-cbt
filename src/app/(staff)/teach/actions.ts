"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireStaff } from "@/lib/auth";
import { fail, ok, bool, int, str, type ActionResult } from "@/lib/actions";
import { getStructure } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";
import { dedupeKey, OPTION_KEYS, parsedQuestionSchema, type ParsedQuestion } from "@/lib/import/questions";
import { DEFAULT_SETTINGS, TYPE_DEFAULTS, type AssessmentSettings, type AssessmentType } from "@/lib/types";

// ---------------------------------------------------------------------------
// Teaching assignments
// ---------------------------------------------------------------------------
export async function requestAssignments(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const staff = await requireStaff();
  const s = await getStructure();
  if (!s.currentSessionId) return fail("No current academic session is set. Ask the super admin.");
  const subjectId = str(fd, "subject_id");
  const classIds = fd.getAll("class_id").map(String);
  const subject = s.subjectById.get(subjectId);
  if (!subject) return fail("Choose a subject.");
  if (classIds.length === 0) return fail("Tick at least one class.");
  const bad = classIds.filter((c) => s.sectionOfClass(c)?.id !== subject.section_id);
  if (bad.length) return fail(`${subject.name} (${s.sectionById.get(subject.section_id)?.name}) can only be taught to classes in that section.`);

  const supabase = await createClient();
  const { error } = await supabase.from("teaching_assignments").upsert(
    classIds.map((class_id) => ({
      teacher_id: staff.id,
      subject_id: subjectId,
      class_id,
      session_id: s.currentSessionId,
      status: "requested",
    })),
    { onConflict: "teacher_id,subject_id,class_id,session_id", ignoreDuplicates: true },
  );
  if (error) return fail(error);
  revalidatePath("/teach/classes");
  return ok("Sent to your Head of Section for approval.");
}

export async function withdrawAssignment(fd: FormData) {
  await requireStaff();
  const supabase = await createClient();
  await supabase.from("teaching_assignments").delete().eq("id", str(fd, "id")).eq("status", "requested");
  revalidatePath("/teach/classes");
}

// ---------------------------------------------------------------------------
// Question bank
// ---------------------------------------------------------------------------
function questionFromForm(fd: FormData): ParsedQuestion | string {
  const options = OPTION_KEYS.map((k) => ({ key: k, text: str(fd, `option_${k}`) }));
  let last = options.length - 1;
  while (last >= 0 && !options[last].text) last -= 1;
  const used = options.slice(0, last + 1);
  if (used.some((o) => !o.text)) return "Fill the options in order A, B, C… without gaps.";
  if (used.length < 2) return "Add at least two options.";
  const answer = str(fd, "answer");
  if (!used.some((o) => o.key === answer)) return "Pick the correct answer from the options you filled in.";
  const d = int(fd, "difficulty", 0);
  const parsed = parsedQuestionSchema.safeParse({
    body: str(fd, "body"),
    options: used,
    answer,
    topic: str(fd, "topic") || null,
    difficulty: d >= 1 && d <= 3 ? d : null,
    explanation: str(fd, "explanation") || null,
    image_url: str(fd, "image_url") || null,
    source: "form",
  });
  if (!parsed.success) return parsed.error.issues[0].message;
  return parsed.data as ParsedQuestion;
}

export async function saveQuestion(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const staff = await requireStaff();
  const q = questionFromForm(fd);
  if (typeof q === "string") return fail(q);
  const supabase = await createClient();
  const id = str(fd, "id");
  const row = {
    body: q.body,
    options: q.options,
    answer: q.answer,
    topic: q.topic,
    difficulty: q.difficulty,
    explanation: q.explanation,
    image_url: q.image_url,
    year_id: str(fd, "year_id") || null,
  };
  if (id) {
    const { error } = await supabase.from("questions").update(row).eq("id", id);
    if (error) return fail(error);
  } else {
    const subjectId = str(fd, "subject_id");
    if (!subjectId) return fail("Choose a subject.");
    const { data, error } = await supabase
      .from("questions")
      .insert({ ...row, subject_id: subjectId, owner_id: staff.id })
      .select("id")
      .single();
    if (error) return fail(error);
    const assessmentId = str(fd, "assessment_id");
    if (assessmentId) {
      await supabase.from("assessment_questions").insert({ assessment_id: assessmentId, question_id: data.id, position: 9999 });
      revalidatePath(`/teach/assessments/${assessmentId}`);
      redirect(`/teach/assessments/${assessmentId}`);
    }
  }
  revalidatePath("/teach/questions");
  if (bool(fd, "add_another")) return ok("Saved. Add the next one.");
  redirect(`/teach/questions?subject=${str(fd, "subject_id")}`);
}

export async function archiveQuestion(fd: FormData) {
  await requireStaff();
  const supabase = await createClient();
  await supabase.from("questions").update({ archived: true }).eq("id", str(fd, "id"));
  revalidatePath("/teach/questions");
}

const importSchema = z.object({
  subjectId: z.string().uuid(),
  yearId: z.string().uuid().nullable(),
  assessmentId: z.string().uuid().nullable(),
  questions: z.array(parsedQuestionSchema).min(1).max(500),
});

export async function commitImport(input: {
  subjectId: string;
  yearId: string | null;
  assessmentId: string | null;
  questions: ParsedQuestion[];
}): Promise<ActionResult> {
  const staff = await requireStaff();
  const parsed = importSchema.safeParse(input);
  if (!parsed.success) return fail("The upload data was not valid. Please try again.");
  const { subjectId, yearId, assessmentId, questions } = parsed.data;
  const supabase = await createClient();

  const { data: existing } = await supabase.from("questions").select("body").eq("subject_id", subjectId).eq("archived", false);
  const seen = new Set((existing ?? []).map((e) => dedupeKey(e.body)));
  const fresh = questions.filter((q) => {
    const k = dedupeKey(q.body);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  if (fresh.length === 0) return ok("Every question in the file is already in the bank — nothing new to add.");

  const { data: inserted, error } = await supabase
    .from("questions")
    .insert(
      fresh.map((q) => ({
        subject_id: subjectId,
        year_id: yearId,
        owner_id: staff.id,
        body: q.body,
        options: q.options,
        answer: q.answer,
        topic: q.topic,
        difficulty: q.difficulty,
        explanation: q.explanation,
        image_url: q.image_url,
      })),
    )
    .select("id");
  if (error) return fail(error);

  if (assessmentId && inserted?.length) {
    const { count } = await supabase
      .from("assessment_questions")
      .select("question_id", { count: "exact", head: true })
      .eq("assessment_id", assessmentId);
    const { error: linkError } = await supabase.from("assessment_questions").insert(
      inserted.map((q, i) => ({ assessment_id: assessmentId, question_id: q.id, position: (count ?? 0) + i + 1 })),
    );
    if (linkError) return fail(linkError);
    revalidatePath(`/teach/assessments/${assessmentId}`);
  }
  revalidatePath("/teach/questions");
  const skipped = questions.length - fresh.length;
  return ok(
    `Added ${fresh.length} question${fresh.length === 1 ? "" : "s"}${skipped ? ` (${skipped} duplicate${skipped === 1 ? "" : "s"} skipped)` : ""}.`,
  );
}

// ---------------------------------------------------------------------------
// Assessments
// ---------------------------------------------------------------------------
export async function createAssessment(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const staff = await requireStaff();
  const s = await getStructure();
  const type = (str(fd, "type") || "test") as AssessmentType;
  if (!TYPE_DEFAULTS[type]) return fail("Choose a type.");
  const subjectId = str(fd, "subject_id");
  const yearId = str(fd, "year_id");
  const subject = s.subjectById.get(subjectId);
  const year = s.yearById.get(yearId);
  if (!subject || !year) return fail("Choose a subject and a year group.");
  if (subject.section_id !== year.section_id) return fail(`${subject.name} isn't offered in ${year.name}'s section.`);
  const termId = str(fd, "term_id") || s.currentTerm?.id;
  if (!termId) return fail("No current term is set. Ask the super admin.");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("assessments")
    .insert({
      subject_id: subjectId,
      year_id: yearId,
      term_id: termId,
      type,
      title: str(fd, "title") || `${subject.name} ${TYPE_DEFAULTS[type].label}`,
      question_count: int(fd, "question_count", TYPE_DEFAULTS[type].questions),
      duration_minutes: int(fd, "duration_minutes", TYPE_DEFAULTS[type].minutes),
      settings: { ...DEFAULT_SETTINGS, require_all_answered: type === "exam" },
      created_by: staff.id,
    })
    .select("id")
    .single();
  if (error) return fail(error);
  redirect(`/teach/assessments/${data.id}`);
}

export async function updateAssessmentSettings(_: ActionResult, fd: FormData): Promise<ActionResult> {
  await requireStaff();
  const id = str(fd, "id");
  const settings: AssessmentSettings = {
    shuffle_questions: bool(fd, "shuffle_questions"),
    shuffle_options: bool(fd, "shuffle_options"),
    require_all_answered: bool(fd, "require_all_answered"),
    allow_flag: bool(fd, "allow_flag"),
    allow_back: bool(fd, "allow_back"),
    show_result: (["none", "score", "full"].includes(str(fd, "show_result")) ? str(fd, "show_result") : "score") as AssessmentSettings["show_result"],
    pass_mark: Math.min(100, Math.max(0, int(fd, "pass_mark", 50))),
    marks_per_question: Math.min(10, Math.max(1, int(fd, "marks_per_question", 1))),
    instructions: str(fd, "instructions").slice(0, 3000),
  };
  const questionCount = int(fd, "question_count", 0);
  const duration = int(fd, "duration_minutes", 0);
  if (questionCount < 1 || questionCount > 200) return fail("Number of questions must be between 1 and 200.");
  if (duration < 1 || duration > 600) return fail("Duration must be between 1 and 600 minutes.");
  const title = str(fd, "title");
  if (!title) return fail("Give it a title.");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("assessments")
    .update({ title, settings, question_count: questionCount, duration_minutes: duration })
    .eq("id", id)
    .select("id");
  if (error) return fail(error);
  if (!data?.length) return fail("This assessment can't be edited any more (it has been submitted or approved).");
  revalidatePath(`/teach/assessments/${id}`);
  return ok("Settings saved.");
}

export async function addQuestionsToAssessment(_: ActionResult, fd: FormData): Promise<ActionResult> {
  await requireStaff();
  const id = str(fd, "assessment_id");
  const ids = fd.getAll("question_id").map(String);
  if (ids.length === 0) return fail("Tick the questions to add.");
  const supabase = await createClient();
  const { count } = await supabase
    .from("assessment_questions")
    .select("question_id", { count: "exact", head: true })
    .eq("assessment_id", id);
  const { error } = await supabase
    .from("assessment_questions")
    .upsert(
      ids.map((q, i) => ({ assessment_id: id, question_id: q, position: (count ?? 0) + i + 1 })),
      { onConflict: "assessment_id,question_id", ignoreDuplicates: true },
    );
  if (error) return fail(error);
  revalidatePath(`/teach/assessments/${id}`);
  return ok(`Added ${ids.length} question${ids.length === 1 ? "" : "s"}.`);
}

export async function removeQuestionFromAssessment(fd: FormData) {
  await requireStaff();
  const supabase = await createClient();
  const id = str(fd, "assessment_id");
  await supabase.from("assessment_questions").delete().eq("assessment_id", id).eq("question_id", str(fd, "question_id"));
  revalidatePath(`/teach/assessments/${id}`);
}

export async function submitForApproval(_: ActionResult, fd: FormData): Promise<ActionResult> {
  await requireStaff();
  const id = str(fd, "id");
  const supabase = await createClient();
  const { error } = await supabase.rpc("submit_assessment", { p_assessment: id });
  if (error) return fail(error);
  revalidatePath(`/teach/assessments/${id}`);
  return ok("Submitted. Your Head of Section will review it and set the exam date.");
}

export async function withdrawSubmission(_: ActionResult, fd: FormData): Promise<ActionResult> {
  await requireStaff();
  const id = str(fd, "id");
  const supabase = await createClient();
  const { error } = await supabase.rpc("reopen_assessment", { p_assessment: id, p_note: null });
  if (error) return fail(error);
  revalidatePath(`/teach/assessments/${id}`);
  return ok("Withdrawn — you can edit it again.");
}

export async function deleteAssessment(fd: FormData) {
  await requireStaff();
  const supabase = await createClient();
  await supabase.from("assessments").delete().eq("id", str(fd, "id")).eq("status", "draft");
  revalidatePath("/teach/assessments");
  redirect("/teach/assessments");
}

export async function duplicateAssessment(fd: FormData) {
  const staff = await requireStaff();
  const supabase = await createClient();
  const { data: a } = await supabase.from("assessments").select("*").eq("id", str(fd, "id")).single();
  if (!a) return;
  const { data: copy } = await supabase
    .from("assessments")
    .insert({
      subject_id: a.subject_id,
      year_id: a.year_id,
      term_id: (await getStructure()).currentTerm?.id ?? a.term_id,
      type: a.type,
      title: `${a.title} (copy)`,
      question_count: a.question_count,
      duration_minutes: a.duration_minutes,
      settings: a.settings,
      created_by: staff.id,
    })
    .select("id")
    .single();
  if (!copy) return;
  const questionIds: string[] = a.paper
    ? (a.paper.questions as { id: string }[]).map((q) => q.id)
    : ((await supabase.from("assessment_questions").select("question_id").eq("assessment_id", a.id).order("position")).data ?? []).map(
        (r) => r.question_id,
      );
  if (questionIds.length) {
    await supabase
      .from("assessment_questions")
      .insert(questionIds.map((q, i) => ({ assessment_id: copy.id, question_id: q, position: i + 1 })));
  }
  redirect(`/teach/assessments/${copy.id}`);
}
