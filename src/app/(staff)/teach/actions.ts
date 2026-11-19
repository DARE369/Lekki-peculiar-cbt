"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/auth";
import { fail, ok, bool, int, str, type ActionResult } from "@/lib/actions";
import { applySubjectPicks } from "@/lib/assignments";
import { getRoundConfigs, getStructure } from "@/lib/data";
import { roundDefaults, roundOf } from "@/lib/rounds";
import { windowState } from "@/lib/labels";
import { createClient } from "@/lib/supabase/server";
import { OPTION_KEYS, parsedQuestionSchema, type ParsedQuestion } from "@/lib/import/questions";
import { DEFAULT_SETTINGS, TYPE_DEFAULTS, type AssessmentSettings, type AssessmentType } from "@/lib/types";
import { lagosLocalToIso } from "@/lib/time";

/** The round a label refers to (rounds are picked by label in forms). */
async function roundIdFor(label: string | null | undefined): Promise<string | null> {
  if (!label) return null;
  const rounds = await getRoundConfigs();
  return rounds.find((r) => r.label.toLowerCase() === label.toLowerCase())?.id ?? null;
}

// ---------------------------------------------------------------------------
// Teaching assignments
// ---------------------------------------------------------------------------
/** Saves the subject/class picker on My classes (several subjects and classes at once). */
export async function saveMySubjects(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const staff = await requireStaff();
  const s = await getStructure();
  const err = await applySubjectPicks(staff.id, s, fd.getAll("pick").map(String));
  if (err) return fail(err);
  revalidatePath("/teach/classes");
  revalidatePath("/dashboard");
  // Straight on to what to do next, instead of staying on the form.
  redirect("/dashboard?done=subjects");
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
    const { data: current } = await supabase.from("questions").select("subject_id").eq("id", id).maybeSingle();
    const backTo = str(fd, "assessment_id");
    if (!backTo) {
      revalidatePath("/teach/questions");
      redirect(`/teach/questions?subject=${current?.subject_id ?? ""}&updated=1`);
    }
    if (backTo) {
      revalidatePath(`/teach/assessments/${backTo}`);
      redirect(`/teach/assessments/${backTo}`);
    }
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
  redirect(`/teach/questions?subject=${str(fd, "subject_id")}&added=1`);
}

export async function archiveQuestion(fd: FormData) {
  await requireStaff();
  const supabase = await createClient();
  await supabase.from("questions").update({ archived: true }).eq("id", str(fd, "id"));
  revalidatePath("/teach/questions");
}

export async function deleteQuestion(fd: FormData) {
  const staff = await requireStaff();
  const supabase = await createClient();
  const id = str(fd, "id");
  const { data: q } = await supabase.from("questions").select("owner_id").eq("id", id).maybeSingle();
  if (!q) return;
  if (q.owner_id !== staff.id && !staff.isAdmin && !staff.isSuperAdmin) return;

  // Block if linked to any live or scheduled exam window.
  const { data: links } = await supabase.from("assessment_questions").select("assessment_id").eq("question_id", id);
  const aIds = (links ?? []).map((l) => l.assessment_id as string);
  if (aIds.length) {
    const { data: wins } = await supabase
      .from("exam_windows")
      .select("status, starts_at, ends_at, auto_start")
      .in("assessment_id", aIds);
    type WC = { status: string; starts_at: string; ends_at: string; auto_start: boolean };
    const active = ((wins ?? []) as unknown as WC[]).some((w) =>
      ["live", "paused", "awaiting_start", "scheduled"].includes(windowState(w)),
    );
    if (active) return; // silently refuse; the bulk-delete UI explains why
  }

  if (aIds.length > 0) {
    await supabase.from("questions").update({ archived: true }).eq("id", id);
  } else {
    await supabase.from("questions").delete().eq("id", id);
  }
  revalidatePath("/teach/questions");
}

type BulkPreview = {
  safe: { id: string; body: string; willHardDelete: boolean }[];
  blocked: { id: string; body: string; reason: string; testTitle: string }[];
};

/** Returns which questions can be safely deleted vs which are blocked by active/upcoming exams. */
const MAX_DELETE = 1000;

/** Splits long id lists so each request stays a sensible size. */
function chunks<T>(list: T[], size = 150): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

export async function previewBulkDelete(ids: string[]): Promise<BulkPreview> {
  if (!ids.length || ids.length > MAX_DELETE) return { safe: [], blocked: [] };
  const staff = await requireStaff();
  const supabase = await createClient();

  const qs: { id: string; body: string; owner_id: string }[] = [];
  for (const part of chunks(ids)) {
    const { data } = await supabase.from("questions").select("id, body, owner_id").in("id", part).eq("archived", false);
    qs.push(...((data ?? []) as typeof qs));
  }

  const owned = (qs ?? []).filter(
    (q) => (q.owner_id as string) === staff.id || staff.isAdmin || staff.isSuperAdmin,
  );
  const ownedIds = owned.map((q) => q.id as string);
  if (!ownedIds.length) return { safe: [], blocked: [] };

  const links: { question_id: string; assessment_id: string }[] = [];
  for (const part of chunks(ownedIds)) {
    const { data } = await supabase.from("assessment_questions").select("question_id, assessment_id").in("question_id", part);
    links.push(...((data ?? []) as typeof links));
  }

  const assessmentIds = [...new Set((links ?? []).map((l) => l.assessment_id as string))];

  type WC = { assessment_id: string; status: string; starts_at: string; ends_at: string; auto_start: boolean };
  const [assRes, winRes] = assessmentIds.length
    ? await Promise.all([
        supabase.from("assessments").select("id, title").in("id", assessmentIds),
        supabase.from("exam_windows").select("assessment_id, status, starts_at, ends_at, auto_start").in("assessment_id", assessmentIds),
      ])
    : [{ data: [] as { id: string; title: string }[] }, { data: [] as WC[] }];

  const titleOf = new Map((assRes.data ?? []).map((a) => [a.id as string, a.title as string]));

  const unsafeAssessments = new Map<string, string>();
  for (const w of (winRes.data ?? []) as unknown as WC[]) {
    const state = windowState(w);
    if (["live", "paused"].includes(state)) {
      unsafeAssessments.set(w.assessment_id, "this question is in a test that is currently live");
    } else if (state === "awaiting_start" && !unsafeAssessments.has(w.assessment_id)) {
      unsafeAssessments.set(w.assessment_id, "this question is in a test that is about to start");
    } else if (state === "scheduled" && !unsafeAssessments.has(w.assessment_id)) {
      unsafeAssessments.set(w.assessment_id, "this question is in a scheduled upcoming exam");
    }
  }

  const linksByQ = new Map<string, string[]>();
  for (const l of links ?? []) {
    const qid = l.question_id as string;
    if (!linksByQ.has(qid)) linksByQ.set(qid, []);
    linksByQ.get(qid)!.push(l.assessment_id as string);
  }

  const safe: BulkPreview["safe"] = [];
  const blocked: BulkPreview["blocked"] = [];
  for (const q of owned) {
    const qAids = linksByQ.get(q.id as string) ?? [];
    const blockerAid = qAids.find((aid) => unsafeAssessments.has(aid));
    if (blockerAid) {
      blocked.push({
        id: q.id as string,
        body: q.body as string,
        reason: unsafeAssessments.get(blockerAid)!,
        testTitle: titleOf.get(blockerAid) ?? "a test",
      });
    } else {
      safe.push({ id: q.id as string, body: q.body as string, willHardDelete: qAids.length === 0 });
    }
  }
  return { safe, blocked };
}

/** Permanently delete (or archive) the given questions after re-checking safety. */
export async function confirmBulkDelete(ids: string[]): Promise<ActionResult> {
  if (!ids.length || ids.length > MAX_DELETE) return fail("Invalid request.");
  const preview = await previewBulkDelete(ids);
  if (preview.safe.length === 0 && preview.blocked.length === 0) return fail("Questions not found or you don't have permission.");
  if (preview.safe.length === 0)
    return fail(`None of the ${preview.blocked.length} question${preview.blocked.length === 1 ? "" : "s"} can be deleted — all are linked to active or upcoming exams.`);

  const supabase = await createClient();
  let deleted = 0;
  let failed = 0;
  // Questions never used in a test are removed; ones used in a past test are archived so its results stay intact.
  const hard = preview.safe.filter((q) => q.willHardDelete).map((q) => q.id);
  const soft = preview.safe.filter((q) => !q.willHardDelete).map((q) => q.id);
  for (const part of chunks(hard)) {
    const { error, count } = await supabase.from("questions").delete({ count: "exact" }).in("id", part);
    if (error) failed += part.length;
    else deleted += count ?? part.length;
  }
  for (const part of chunks(soft)) {
    const { error, count } = await supabase.from("questions").update({ archived: true }, { count: "exact" }).in("id", part);
    if (error) failed += part.length;
    else deleted += count ?? part.length;
  }
  if (deleted === 0 && failed > 0) return fail("Those questions couldn't be deleted. Nothing was changed — please try again.");

  revalidatePath("/teach/questions");
  const skipped = preview.blocked.length;
  return ok(
    `${deleted} question${deleted === 1 ? "" : "s"} deleted${skipped ? ` · ${skipped} kept because they're in a live or upcoming exam` : ""}${failed ? ` · ${failed} couldn't be deleted, try again` : ""}.`,
    { deleted, blocked: skipped },
  );
}

// ---------------------------------------------------------------------------
// Uploads (named sets of questions)
// ---------------------------------------------------------------------------
async function uploadQuestionIds(supabase: Awaited<ReturnType<typeof createClient>>, uploadId: string) {
  const ids: string[] = [];
  for (let from = 0; ; from += 1000) {
    const { data } = await supabase.from("questions").select("id").eq("upload_id", uploadId).eq("archived", false).range(from, from + 999);
    ids.push(...(data ?? []).map((r) => r.id as string));
    if (!data || data.length < 1000) break;
  }
  return ids;
}

export async function renameUpload(_: ActionResult, fd: FormData): Promise<ActionResult> {
  await requireStaff();
  const label = str(fd, "label").slice(0, 80);
  if (!label) return fail("Give the upload a name.");
  const supabase = await createClient();
  const { data, error } = await supabase.from("question_uploads").update({ label }).eq("id", str(fd, "id")).select("id");
  if (error) return fail(error);
  if (!data?.length) return fail("Only the teacher who uploaded these (or an admin) can rename them.");
  revalidatePath("/teach/questions");
  return ok("Renamed.");
}

/** What deleting a whole upload would do (some questions may be in a live or upcoming exam). */
export async function previewUploadDelete(uploadId: string): Promise<BulkPreview> {
  await requireStaff();
  const supabase = await createClient();
  const ids = await uploadQuestionIds(supabase, uploadId);
  if (!ids.length) return { safe: [], blocked: [] };
  return previewBulkDelete(ids);
}

/** Deletes an upload's questions (keeping any in live/upcoming exams); removes the upload once it's empty. */
export async function confirmUploadDelete(uploadId: string): Promise<ActionResult> {
  await requireStaff();
  const supabase = await createClient();
  const ids = await uploadQuestionIds(supabase, uploadId);
  let message = "Upload deleted.";
  if (ids.length) {
    const res = await confirmBulkDelete(ids);
    if (!res?.ok) return res;
    message = res.message ?? message;
  }
  const left = await uploadQuestionIds(supabase, uploadId);
  if (left.length === 0) {
    const { error } = await supabase.from("question_uploads").delete().eq("id", uploadId);
    if (error) return fail(error);
  }
  revalidatePath("/teach/questions");
  return ok(message);
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
  // The classes (arms) it's for: must be in this year group and, for teachers, classes they're approved to teach.
  const classIds = [...new Set(fd.getAll("class_id").map(String))].filter((c) => s.classById.get(c)?.year_id === yearId);
  const adminHere = staff.isSuperAdmin || (staff.isAdmin && staff.sectionIds.includes(subject.section_id));
  if (!adminHere) {
    const { data: mine } = await supabase
      .from("teaching_assignments")
      .select("class_id")
      .eq("teacher_id", staff.id)
      .eq("subject_id", subjectId)
      .eq("session_id", s.currentSessionId ?? "")
      .eq("status", "approved");
    const allowed = new Set((mine ?? []).map((r) => r.class_id as string));
    if (classIds.some((c) => !allowed.has(c))) return fail("You can only set tests for classes you've been approved to teach.");
  }
  if (classIds.length === 0) return fail("Tick at least one class the test is for.");
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
      settings: { ...DEFAULT_SETTINGS, require_all_answered: type === "exam", ...(str(fd, "instructions") ? { instructions: str(fd, "instructions") } : {}) },
      class_ids: classIds,
      created_by: staff.id,
      ...(str(fd, "sequence_label")
        ? { sequence_label: str(fd, "sequence_label").slice(0, 30), round_id: await roundIdFor(str(fd, "sequence_label").slice(0, 30)) }
        : {}),
    })
    .select("id")
    .single();
  if (error) return fail(error);
  // Started from an upload in the bank: put that upload's questions straight into the new test.
  const fromUpload = str(fd, "from_upload");
  let added = 0;
  if (fromUpload) {
    const ids = await uploadQuestionIds(supabase, fromUpload);
    const { data: same } = ids.length
      ? await supabase.from("questions").select("id, created_at").in("id", ids.slice(0, 500)).eq("subject_id", subjectId).order("created_at")
      : { data: [] };
    const rows = (same ?? []).map((q, i) => ({ assessment_id: data.id, question_id: q.id as string, position: i + 1 }));
    if (rows.length) {
      const { error: linkError } = await supabase.from("assessment_questions").insert(rows);
      if (!linkError) added = rows.length;
    }
  }
  redirect(`/teach/assessments/${data.id}${added ? `?added=${added}` : ""}`);
}

/** Parses a decimal like "0.5" or "2,5"; null when empty or not a number. */
function num(fd: FormData, key: string): number | null {
  const raw = str(fd, key).replace(",", ".");
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/** Saves the test's settings. Called by the settings panel as the teacher types (auto-save). */
export async function updateAssessmentSettings(_: ActionResult, fd: FormData): Promise<ActionResult> {
  await requireStaff();
  const id = str(fd, "id");
  const marksMode = str(fd, "marks_mode") === "total" ? "total" : "per_question";
  const perQ = num(fd, "marks_per_question") ?? 1;
  const total = num(fd, "total_marks");
  if (perQ < 0.1 || perQ > 100) return fail("Marks per question must be between 0.1 and 100.");
  if (marksMode === "total" && (total === null || total < 1 || total > 1000)) return fail("Enter what the test is out of (between 1 and 1000).");
  const settings: AssessmentSettings = {
    shuffle_questions: bool(fd, "shuffle_questions"),
    shuffle_options: bool(fd, "shuffle_options"),
    require_all_answered: bool(fd, "require_all_answered"),
    allow_flag: bool(fd, "allow_flag"),
    allow_back: bool(fd, "allow_back"),
    show_result: (["none", "score", "full"].includes(str(fd, "show_result")) ? str(fd, "show_result") : "score") as AssessmentSettings["show_result"],
    pass_mark: Math.min(100, Math.max(0, int(fd, "pass_mark", 50))),
    marks_mode: marksMode,
    marks_per_question: Math.round(perQ * 10) / 10,
    total_marks: marksMode === "total" && total !== null ? Math.round(total * 10) / 10 : null,
    instructions: str(fd, "instructions").slice(0, 3000),
  };
  const questionCount = int(fd, "question_count", 0);
  const duration = int(fd, "duration_minutes", 0);
  if (questionCount < 1 || questionCount > 200) return fail("Number of questions must be between 1 and 200.");
  if (duration < 1 || duration > 600) return fail("Time must be between 1 and 600 minutes.");
  const title = str(fd, "title");
  if (!title) return fail("Give it a title.");
  const rawType = str(fd, "type") as AssessmentType;
  const type = rawType && rawType in TYPE_DEFAULTS ? rawType : null;

  const supabase = await createClient();
  const topic = str(fd, "topic").trim().slice(0, 200) || null;
  const sequenceLabel = str(fd, "sequence_label").slice(0, 30) || null;
  const { data, error } = await supabase
    .from("assessments")
    .update({ title, topic, settings, question_count: questionCount, duration_minutes: duration, ...(type ? { type } : {}), sequence_label: sequenceLabel, round_id: await roundIdFor(sequenceLabel) })
    .eq("id", id)
    .select("id");
  if (error) return fail(error, "assessment.settings");
  if (!data?.length) return fail("This test can't be edited any more (it has been submitted or approved).");
  revalidatePath(`/teach/assessments/${id}`);
  return ok("Saved.");
}

export type PaperChecklist = { blockers: string[]; warnings: string[] };

/** What must be fixed before a test can go for review, and what is worth a second look. */
export async function paperChecklist(id: string): Promise<PaperChecklist> {
  await requireStaff();
  const supabase = await createClient();
  const blockers: string[] = [];
  const warnings: string[] = [];
  const problem = await paperProblems(supabase, id);
  if (problem) blockers.push(problem);
  const { data: a } = await supabase.from("assessments").select("topic, settings, question_count, duration_minutes").eq("id", id).maybeSingle();
  if (a) {
    const st = { ...DEFAULT_SETTINGS, ...(a.settings ?? {}) } as AssessmentSettings;
    if (!st.instructions?.trim()) warnings.push("There are no instructions for students.");
    if (!a.topic?.trim()) warnings.push("No topic is set. It helps the reviewer and appears in reports.");
    if ((st.marks_mode ?? "per_question") === "per_question" && (st.marks_per_question ?? 1) === 1) {
      warnings.push(`Marks are still the default: 1 mark per question, so the test is out of ${a.question_count}. Change this under Marks if it should be out of something else.`);
    }
  }
  return { blockers, warnings };
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

export async function addAllBankQuestions(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const staff = await requireStaff();
  const id = str(fd, "assessment_id");
  const topicFilter = str(fd, "topic");
  const uploadFilter = str(fd, "upload");
  const roundFilter = str(fd, "round");
  const supabase = await createClient();
  const { data: a } = await supabase.from("assessments").select("subject_id, year_id, created_by, status, amending").eq("id", id).maybeSingle();
  if (!a) return fail("Test not found.");
  if (a.created_by !== staff.id && !staff.isAdmin && !staff.isSuperAdmin) return fail("Not authorised.");
  const editable = ["draft", "changes_requested"].includes(a.status) || (a.status === "approved" && Boolean(a.amending));
  if (!editable) return fail("This test can't be edited right now.");
  const { data: existing } = await supabase.from("assessment_questions").select("question_id").eq("assessment_id", id);
  const existingIds = new Set((existing ?? []).map((r) => r.question_id as string));
  let qQuery = supabase.from("questions").select("id").eq("subject_id", a.subject_id).eq("archived", false).or(`year_id.eq.${a.year_id},year_id.is.null`);
  if (topicFilter) qQuery = qQuery.eq("topic", topicFilter);
  if (uploadFilter === "none") qQuery = qQuery.is("upload_id", null);
  else if (uploadFilter) qQuery = qQuery.eq("upload_id", uploadFilter);
  if (roundFilter === "none") qQuery = qQuery.is("round_id", null);
  else if (roundFilter && roundFilter !== "all") qQuery = qQuery.eq("round_id", roundFilter);
  const { data: bank } = await qQuery.order("created_at").limit(1000);
  const toAdd = (bank ?? []).filter((q) => !existingIds.has(q.id as string));
  if (toAdd.length === 0) return ok("All matching questions are already in this test.");
  const { count } = await supabase.from("assessment_questions").select("question_id", { count: "exact", head: true }).eq("assessment_id", id);
  const { error } = await supabase.from("assessment_questions").upsert(
    toAdd.map((q, i) => ({ assessment_id: id, question_id: q.id, position: (count ?? 0) + i + 1 })),
    { onConflict: "assessment_id,question_id", ignoreDuplicates: true },
  );
  if (error) return fail(error);
  revalidatePath(`/teach/assessments/${id}`);
  return ok(`Added ${toAdd.length} question${toAdd.length === 1 ? "" : "s"}.`);
}

export async function autoFillAssessment(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const staff = await requireStaff();
  const id = str(fd, "assessment_id");
  const supabase = await createClient();
  const { data: a } = await supabase.from("assessments").select("subject_id, year_id, question_count, created_by, status, round_id, sequence_label").eq("id", id).maybeSingle();
  if (!a) return fail("Test not found.");
  if (a.created_by !== staff.id && !staff.isAdmin && !staff.isSuperAdmin) return fail("Not authorised.");
  if (!["draft", "changes_requested"].includes(a.status)) return fail("This test can't be edited right now.");
  const { count: current } = await supabase.from("assessment_questions").select("id", { count: "exact", head: true }).eq("assessment_id", id);
  const needed = (a.question_count as number) - (current ?? 0);
  if (needed <= 0) return ok(`Already has ${current} questions — enough for this test.`);
  const { data: existing } = await supabase.from("assessment_questions").select("question_id").eq("assessment_id", id);
  const existingIds = new Set((existing ?? []).map((r) => r.question_id as string));
  const { data: bank } = await supabase.from("questions").select("id, round_id").eq("subject_id", a.subject_id).eq("archived", false).or(`year_id.eq.${a.year_id},year_id.is.null`);
  // Never mix rounds: this test's round first, then questions not sorted into any round yet.
  const paperRound = roundOf(a, await getRoundConfigs())?.id ?? null;
  const fresh = (bank ?? []).filter((q) => !existingIds.has(q.id as string));
  const shuffle = <T,>(xs: T[]) => xs.sort(() => Math.random() - 0.5);
  const available = paperRound
    ? [...shuffle(fresh.filter((q) => q.round_id === paperRound)), ...shuffle(fresh.filter((q) => !q.round_id))]
    : shuffle(fresh);
  if (available.length === 0) return fail("No more questions in the bank for this subject.");
  const shuffled = available.slice(0, needed);
  const basePos = (current ?? 0) + 1;
  const { error } = await supabase.from("assessment_questions").upsert(
    shuffled.map((q, i) => ({ assessment_id: id, question_id: q.id, position: basePos + i })),
    { onConflict: "assessment_id,question_id", ignoreDuplicates: true },
  );
  if (error) return fail(error);
  revalidatePath(`/teach/assessments/${id}`);
  return ok(`Picked ${shuffled.length} question${shuffled.length === 1 ? "" : "s"} at random${available.length < needed ? " — that's all that was available" : ""}.`);
}

export async function removeQuestionFromAssessment(fd: FormData) {
  await requireStaff();
  const supabase = await createClient();
  const id = str(fd, "assessment_id");
  await supabase.from("assessment_questions").delete().eq("assessment_id", id).eq("question_id", str(fd, "question_id"));
  revalidatePath(`/teach/assessments/${id}`);
}

/** What would stop a paper being sent for review, in words a teacher can act on (null = ready). */
async function paperProblems(supabase: Awaited<ReturnType<typeof createClient>>, id: string): Promise<string | null> {
  const { data: a } = await supabase.from("assessments").select("question_count, class_ids").eq("id", id).maybeSingle();
  if (!a) return "This test can't be found.";
  if (!((a.class_ids ?? []) as string[]).length) return "Choose which classes this test is for (Classes, on the right).";
  const { data: rows } = await supabase
    .from("assessment_questions")
    .select("position, questions(body, options, answer)")
    .eq("assessment_id", id)
    .order("position");
  const qs = (rows ?? []).map((r) => r.questions as unknown as { body: string; options: { key: string; text: string }[]; answer: string } | null);
  const broken = qs.findIndex((q) => !q || !Array.isArray(q.options) || q.options.length < 2 || !q.options.some((o) => o.key === q.answer));
  if (broken >= 0) return `Question ${broken + 1} has no valid correct answer. Edit it, choose the correct option, then send again.`;
  if (qs.length < (a.question_count as number)) {
    const short = (a.question_count as number) - qs.length;
    return `This test needs ${short} more question${short === 1 ? "" : "s"} (it has ${qs.length} of ${a.question_count}). Add more, or lower the number of questions in Settings.`;
  }
  return null;
}

export async function submitForApproval(_: ActionResult, fd: FormData): Promise<ActionResult> {
  await requireStaff();
  const id = str(fd, "id");
  const supabase = await createClient();

  // Save topic from the submit form if provided (avoids requiring a separate "Save settings" click).
  const topicFromForm = str(fd, "topic").trim().slice(0, 200);
  if (topicFromForm) {
    await supabase.from("assessments").update({ topic: topicFromForm }).eq("id", id);
  }

  // The machine checks, people judge: anything we can verify is checked here, with a message that
  // says exactly what to fix, before it ever reaches the Head of Section. (Topic is optional.)
  const problem = await paperProblems(supabase, id);
  if (problem) return fail(problem);
  const { error } = await supabase.rpc("submit_assessment", { p_assessment: id });
  if (error) return fail(error);
  revalidatePath(`/teach/assessments/${id}`);
  revalidatePath("/dashboard");
  redirect("/dashboard?done=submitted");
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
  const staff = await requireStaff();
  const id = str(fd, "id");
  const supabase = await createClient();

  const { data: a } = await supabase.from("assessments").select("created_by").eq("id", id).maybeSingle();
  if (!a) return;
  if (a.created_by !== staff.id && !staff.isAdmin && !staff.isSuperAdmin) return;

  // Block if any exam window has already started
  const { count } = await supabase
    .from("exam_windows")
    .select("id", { count: "exact", head: true })
    .eq("assessment_id", id)
    .lte("starts_at", new Date().toISOString());
  if ((count ?? 0) > 0) return; // gone live — silently ignore

  await supabase.from("assessments").delete().eq("id", id);
  revalidatePath("/teach/assessments");
  redirect("/teach/assessments");
}

export async function updateAssessmentClasses(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const staff = await requireStaff();
  const id = str(fd, "id");
  const s = await getStructure();
  const supabase = await createClient();

  const { data: a } = await supabase.from("assessments").select("created_by, year_id, subject_id").eq("id", id).maybeSingle();
  if (!a) return fail("Test not found.");

  const isOwner = a.created_by === staff.id;
  const isAdmin = staff.isAdmin || staff.isSuperAdmin;
  if (!isOwner && !isAdmin) return fail("You don't have permission to edit this test.");

  // Block if any exam window has already started
  const { count } = await supabase
    .from("exam_windows")
    .select("id", { count: "exact", head: true })
    .eq("assessment_id", id)
    .lte("starts_at", new Date().toISOString());
  if ((count ?? 0) > 0) return fail("This test has already started — classes can't be changed.");

  const classIds = [...new Set(fd.getAll("class_id").map(String))].filter((c) => s.classById.get(c)?.year_id === a.year_id);
  if (classIds.length === 0) return fail("Tick at least one class.");

  if (!isAdmin) {
    const { data: mine } = await supabase
      .from("teaching_assignments")
      .select("class_id")
      .eq("teacher_id", staff.id)
      .eq("subject_id", a.subject_id)
      .eq("session_id", s.currentSessionId ?? "")
      .eq("status", "approved");
    const allowed = new Set((mine ?? []).map((r) => r.class_id as string));
    if (classIds.some((c) => !allowed.has(c))) return fail("You can only assign classes you're approved to teach.");
  }

  await supabase.from("assessments").update({ class_ids: classIds }).eq("id", id);
  revalidatePath(`/teach/assessments/${id}`);
  return ok("Classes updated.");
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

// ---------------------------------------------------------------------------
// Correcting a flagged test after it was approved
// ---------------------------------------------------------------------------
/** Start correcting a flagged, approved test. The approved version stays in force until the corrections are accepted. */
export async function beginCorrection(fd: FormData) {
  await requireStaff();
  const id = str(fd, "id");
  const { error } = await (await createClient()).rpc("begin_amendment", { p_assessment: id });
  revalidatePath("/dashboard");
  if (error) redirect(`/teach/assessments/${id}?error=${encodeURIComponent(error.message)}`);
  redirect(`/teach/assessments/${id}`);
}

export async function submitCorrections(_: ActionResult, fd: FormData): Promise<ActionResult> {
  await requireStaff();
  const id = str(fd, "id");
  const { error } = await (await createClient()).rpc("submit_amendment", { p_assessment: id });
  if (error) return fail(error);
  revalidatePath(`/teach/assessments/${id}`);
  revalidatePath("/dashboard");
  redirect("/dashboard?done=corrected");
}

export async function cancelCorrection(fd: FormData) {
  await requireStaff();
  const id = str(fd, "id");
  await (await createClient()).rpc("cancel_amendment", { p_assessment: id });
  revalidatePath(`/teach/assessments/${id}`);
  revalidatePath("/dashboard");
  redirect(`/teach/assessments/${id}`);
}

// ---------------------------------------------------------------------------
// Scheduling
// ---------------------------------------------------------------------------
export async function scheduleAssessmentWindow(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const staff = await requireStaff();
  const id = str(fd, "id");
  const classId = str(fd, "class_id");
  const startsLocal = str(fd, "starts_at");
  const windowHours = int(fd, "window_hours", 2);

  const startsIso = lagosLocalToIso(startsLocal);
  if (!startsIso) return fail("Enter a valid start date and time.");
  const endsIso = new Date(new Date(startsIso).getTime() + windowHours * 3_600_000).toISOString();

  const supabase = await createClient();
  const { data: a } = await supabase.from("assessments").select("created_by, subject_id, class_ids, status").eq("id", id).maybeSingle();
  if (!a) return fail("Test not found.");
  if (a.status !== "approved") return fail("Only approved tests can be scheduled.");
  if (!(a.class_ids as string[] ?? []).includes(classId)) return fail("That class isn't assigned to this test.");

  if (!staff.isAdmin && !staff.isSuperAdmin) {
    const s = await getStructure();
    const { data: mine } = await supabase
      .from("teaching_assignments")
      .select("class_id")
      .eq("teacher_id", staff.id)
      .eq("subject_id", a.subject_id)
      .eq("session_id", s.currentSessionId ?? "")
      .eq("status", "approved");
    const allowed = new Set((mine ?? []).map((r) => r.class_id as string));
    if (!allowed.has(classId)) return fail("You're not approved to teach this class.");
  }

  const { error } = await supabase.rpc("schedule_window", {
    p_assessment: id,
    p_class: classId,
    p_starts: startsIso,
    p_ends: endsIso,
    p_auto_start: !bool(fd, "manual_start"),
  });
  if (error) return fail(error);
  revalidatePath(`/teach/assessments/${id}`);
  return ok("Scheduled.");
}

// ---------------------------------------------------------------------------
// Batch test creation
// ---------------------------------------------------------------------------
export async function createBatchAssessments(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const staff = await requireStaff();
  const s = await getStructure();
  const type = (str(fd, "type") || "test") as AssessmentType;
  if (!TYPE_DEFAULTS[type]) return fail("Choose a type.");
  const batchLabel = str(fd, "sequence_label").slice(0, 30) || null;
  const batchRound = await roundIdFor(batchLabel);
  const termId = s.currentTerm?.id;
  if (!termId) return fail("No current term is set — ask the super admin.");
  const instructions = str(fd, "instructions");

  const picks = [...new Set(fd.getAll("pick").map(String))];
  if (picks.length === 0) return fail("Select at least one class and subject.");

  // Group by (subjectId, yearId) → collect classIds
  const groups = new Map<string, { subjectId: string; yearId: string; classIds: string[] }>();
  for (const pick of picks) {
    const [classId, subjectId] = pick.split(":");
    const cls = s.classById.get(classId);
    if (!cls) continue;
    const key = `${subjectId}:${cls.year_id}`;
    if (!groups.has(key)) groups.set(key, { subjectId, yearId: cls.year_id, classIds: [] });
    groups.get(key)!.classIds.push(classId);
  }
  if (groups.size === 0) return fail("No valid selections.");

  const supabase = await createClient();
  if (!staff.isAdmin && !staff.isSuperAdmin) {
    const { data: mine } = await supabase
      .from("teaching_assignments")
      .select("class_id, subject_id")
      .eq("teacher_id", staff.id)
      .eq("session_id", s.currentSessionId ?? "")
      .eq("status", "approved");
    const allowedSet = new Set((mine ?? []).map((r) => `${r.class_id}:${r.subject_id}`));
    for (const [, g] of groups) {
      for (const cid of g.classIds) {
        if (!allowedSet.has(`${cid}:${g.subjectId}`)) return fail("You don't have permission for some of the selected classes.");
      }
    }
  }

  const created: string[] = [];
  for (const [, g] of groups) {
    const sub = s.subjectById.get(g.subjectId);
    if (!sub) continue;
    const { data } = await supabase
      .from("assessments")
      .insert({
        subject_id: g.subjectId,
        year_id: g.yearId,
        term_id: termId,
        type,
        title: `${sub.name} ${TYPE_DEFAULTS[type].label}`,
        question_count: TYPE_DEFAULTS[type].questions,
        duration_minutes: TYPE_DEFAULTS[type].minutes,
        settings: { ...DEFAULT_SETTINGS, require_all_answered: type === "exam", ...(instructions ? { instructions } : {}) },
        class_ids: g.classIds,
        created_by: staff.id,
        ...(batchLabel ? { sequence_label: batchLabel, round_id: batchRound } : {}),
      })
      .select("id")
      .single();
    if (data) created.push(data.id);
  }
  if (created.length === 0) return fail("Failed to create tests.");
  revalidatePath("/teach/assessments");
  if (created.length === 1) redirect(`/teach/assessments/${created[0]}`);
  redirect("/teach/assessments");
}

// ---------------------------------------------------------------------------
// Rounds for questions
// ---------------------------------------------------------------------------
/** Moves the ticked questions into a round (only the teacher's own, or any in an admin's section — RLS decides). */
export async function moveQuestionsToRound(ids: string[], roundId: string): Promise<ActionResult> {
  await requireStaff();
  if (!ids.length || ids.length > 1000) return fail("Tick the questions to move.");
  const rounds = await getRoundConfigs();
  const round = rounds.find((r) => r.id === roundId);
  if (!round) return fail("Choose a round.");
  const s = await getStructure();
  const supabase = await createClient();
  let moved = 0;
  for (let i = 0; i < ids.length; i += 150) {
    const part = ids.slice(i, i + 150);
    const { error, count } = await supabase
      .from("questions")
      .update({ round_id: round.id, term_id: s.currentTerm?.id ?? null }, { count: "exact" })
      .in("id", part);
    if (error) return fail(error, "questions.move_round");
    moved += count ?? 0;
  }
  revalidatePath("/teach/questions");
  if (moved < ids.length) return ok(`${moved} moved to ${round.label}. ${ids.length - moved} weren't yours to move.`);
  return ok(`${moved} question${moved === 1 ? "" : "s"} moved to ${round.label}.`);
}

/**
 * Sorts a teacher's older questions (from before rounds) into rounds, but only when it's certain:
 * a question used in tests of exactly one round goes to that round. Nothing else is touched.
 */
export async function autoSortIntoRounds(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const staff = await requireStaff();
  const subjectId = str(fd, "subject_id");
  const yearId = str(fd, "year_id");
  const supabase = await createClient();
  const rounds = await getRoundConfigs();

  const unsorted: string[] = [];
  for (let from = 0; ; from += 1000) {
    let q = supabase.from("questions").select("id").eq("owner_id", staff.id).eq("subject_id", subjectId).eq("archived", false).is("round_id", null).range(from, from + 999);
    if (yearId) q = q.or(`year_id.eq.${yearId},year_id.is.null`);
    const { data } = await q;
    unsorted.push(...(data ?? []).map((r) => r.id as string));
    if (!data || data.length < 1000) break;
  }
  if (!unsorted.length) return ok("Everything is already in a round.");

  const links: { question_id: string; assessment_id: string }[] = [];
  for (let i = 0; i < unsorted.length; i += 150) {
    const { data } = await supabase.from("assessment_questions").select("question_id, assessment_id").in("question_id", unsorted.slice(i, i + 150));
    links.push(...((data ?? []) as typeof links));
  }
  const aIds = [...new Set(links.map((l) => l.assessment_id))];
  const papers = new Map<string, { round: string | null; term: string }>();
  for (let i = 0; i < aIds.length; i += 150) {
    const { data } = await supabase.from("assessments").select("id, round_id, sequence_label, term_id").in("id", aIds.slice(i, i + 150));
    for (const a of data ?? []) {
      const r = a.round_id ? rounds.find((x) => x.id === a.round_id) : rounds.find((x) => x.label.toLowerCase() === String(a.sequence_label ?? "").toLowerCase());
      papers.set(a.id as string, { round: r?.id ?? null, term: a.term_id as string });
    }
  }
  // question → the single (round, term) all its papers agree on
  const target = new Map<string, string>();
  const byQ = new Map<string, Set<string>>();
  for (const l of links) {
    const p = papers.get(l.assessment_id);
    const key = p?.round ? `${p.round}|${p.term}` : "?";
    if (!byQ.has(l.question_id)) byQ.set(l.question_id, new Set());
    byQ.get(l.question_id)!.add(key);
  }
  for (const [qid, keys] of byQ) if (keys.size === 1 && !keys.has("?")) target.set(qid, [...keys][0]);

  const groups = new Map<string, string[]>();
  for (const [qid, key] of target) {
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(qid);
  }
  let sorted = 0;
  for (const [key, qids] of groups) {
    const [round_id, term_id] = key.split("|");
    for (let i = 0; i < qids.length; i += 150) {
      const { error, count } = await supabase.from("questions").update({ round_id, term_id }, { count: "exact" }).in("id", qids.slice(i, i + 150));
      if (error) return fail(error, "questions.auto_sort");
      sorted += count ?? 0;
    }
  }
  revalidatePath("/teach/questions");
  const left = unsorted.length - sorted;
  return ok(
    sorted
      ? `Sorted ${sorted} question${sorted === 1 ? "" : "s"} into the round of the test they're used in.${left ? ` ${left} weren't used in a test with a round — tick them and choose Move to round.` : ""}`
      : `None of these are used in a test with a round, so they couldn't be sorted automatically. Tick them and choose Move to round.`,
  );
}

// ---------------------------------------------------------------------------
// This term's papers: one paper per subject × year group × round (a second one only for other arms)
// ---------------------------------------------------------------------------
export async function openPaperForRound(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const staff = await requireStaff();
  const s = await getStructure();
  const subjectId = str(fd, "subject_id");
  const yearId = str(fd, "year_id");
  const subject = s.subjectById.get(subjectId);
  const year = s.yearById.get(yearId);
  const round = (await getRoundConfigs()).find((r) => r.id === str(fd, "round_id"));
  const termId = s.currentTerm?.id;
  if (!subject || !year || !round) return fail("That paper can't be found. Refresh the page and try again.");
  if (!termId) return fail("No current term is set. Ask the super admin.");
  const supabase = await createClient();

  // My classes for this subject and year (all the year's classes for its Head of Section).
  const adminHere = staff.isSuperAdmin || (staff.isAdmin && staff.sectionIds.includes(subject.section_id));
  let mine: string[];
  if (adminHere) {
    mine = s.classes.filter((c) => c.active && c.year_id === yearId).map((c) => c.id);
  } else {
    const { data } = await supabase
      .from("teaching_assignments")
      .select("class_id")
      .eq("teacher_id", staff.id)
      .eq("subject_id", subjectId)
      .eq("session_id", s.currentSessionId ?? "")
      .eq("status", "approved");
    mine = (data ?? []).map((r) => r.class_id as string).filter((c) => s.classById.get(c)?.year_id === yearId);
  }
  if (mine.length === 0) {
    return fail("Your classes for this subject haven't been approved yet. You can still upload questions for this round meanwhile.");
  }

  // Already a paper for this subject, year and round? Use it if it covers my classes.
  const { data: existing } = await supabase
    .from("assessments")
    .select("id, class_ids, round_id, sequence_label")
    .eq("subject_id", subjectId)
    .eq("year_id", yearId)
    .eq("term_id", termId);
  const rounds = await getRoundConfigs();
  const same = (existing ?? []).filter((a) => roundOf(a, rounds)?.id === round.id);
  const covered = new Set(same.flatMap((a) => (a.class_ids ?? []) as string[]));
  const ownPaper = same.find((a) => mine.some((c) => ((a.class_ids ?? []) as string[]).includes(c)));
  const uncovered = mine.filter((c) => !covered.has(c));
  if (ownPaper && uncovered.length === 0) redirect(`/teach/assessments/${ownPaper.id}`);

  const d = roundDefaults(round);
  const forClasses = ownPaper ? uncovered : mine;
  const arms = ownPaper ? ` (${forClasses.map((c) => s.classById.get(c)?.name).join(", ")})` : "";
  const { data, error } = await supabase
    .from("assessments")
    .insert({
      subject_id: subjectId,
      year_id: yearId,
      term_id: termId,
      type: d.type,
      title: `${subject.name} — ${round.label}${arms}`.slice(0, 200),
      question_count: d.questions,
      duration_minutes: d.minutes,
      settings: { ...DEFAULT_SETTINGS, require_all_answered: d.type === "exam" || d.type === "mock" },
      class_ids: forClasses,
      created_by: staff.id,
      sequence_label: round.label,
      round_id: round.id,
    })
    .select("id")
    .single();
  if (error) return fail(error, "papers.create");
  revalidatePath("/teach/papers");
  redirect(`/teach/assessments/${data.id}?new=1`);
}
