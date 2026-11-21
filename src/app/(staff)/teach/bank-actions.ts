"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/auth";
import { fail, ok, type ActionResult } from "@/lib/actions";
import { getRoundConfigs, getStructure } from "@/lib/data";
import { roundDefaults } from "@/lib/rounds";
import { createClient } from "@/lib/supabase/server";
import { DEFAULT_SETTINGS, TYPE_DEFAULTS } from "@/lib/types";

type Supabase = Awaited<ReturnType<typeof createClient>>;
const CHUNK = 150;

function chunks<T>(xs: T[]) {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += CHUNK) out.push(xs.slice(i, i + CHUNK));
  return out;
}

async function questionsInfo(supabase: Supabase, ids: string[]) {
  const rows: { id: string; subject_id: string; year_id: string | null; round_id: string | null; created_at: string }[] = [];
  for (const part of chunks(ids)) {
    const { data } = await supabase.from("questions").select("id, subject_id, year_id, round_id, created_at").in("id", part).eq("archived", false);
    rows.push(...((data ?? []) as typeof rows));
  }
  return rows;
}

/**
 * Moves the ticked questions into a bank: an existing one, or a new one with the given name.
 * A question belongs to one bank, so it leaves the bank it was in.
 */
export async function moveToBank(input: { ids: string[]; bankId?: string; newName?: string; subjectId: string; yearId: string | null }): Promise<ActionResult> {
  const staff = await requireStaff();
  const ids = [...new Set(input.ids)].slice(0, 5000);
  if (!ids.length) return fail("Tick the questions first.");
  const supabase = await createClient();
  let bankId = input.bankId ?? null;
  let bankName = "";
  if (!bankId) {
    const name = (input.newName ?? "").trim().slice(0, 80);
    if (!name) return fail("Give the new bank a name.");
    const s = await getStructure();
    const rounds = [...new Set((await questionsInfo(supabase, ids)).map((q) => q.round_id))];
    const { data, error } = await supabase
      .from("question_uploads")
      .insert({
        round_id: rounds.length === 1 ? rounds[0] : null,
        owner_id: staff.id,
        subject_id: input.subjectId,
        year_id: input.yearId,
        term_id: s.currentTerm?.id ?? null,
        label: name,
        source_format: "manual",
        found_count: ids.length,
        imported_count: ids.length,
      })
      .select("id")
      .single();
    if (error) return fail(error, "banks.create");
    bankId = data.id as string;
    bankName = name;
  } else {
    const { data } = await supabase.from("question_uploads").select("label").eq("id", bankId).maybeSingle();
    if (!data) return fail("That bank no longer exists.");
    bankName = data.label as string;
  }
  let moved = 0;
  for (const part of chunks(ids)) {
    const { error, count } = await supabase.from("questions").update({ upload_id: bankId }, { count: "exact" }).in("id", part);
    if (error) return fail(error, "banks.move");
    moved += count ?? 0;
  }
  revalidatePath("/teach/questions");
  return ok(`${moved} question${moved === 1 ? "" : "s"} now in “${bankName}”.${moved < ids.length ? ` ${ids.length - moved} weren't yours to move.` : ""}`);
}

/** Names a group of older questions (from one earlier upload) as a bank, so it can be found and used. */
export async function nameEarlierGroup(input: { ids: string[]; name: string; subjectId: string; yearId: string | null }): Promise<ActionResult> {
  const name = input.name.trim().slice(0, 80);
  if (!name) return fail("Give the bank a name.");
  const staff = await requireStaff();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("question_uploads")
    .insert({ owner_id: staff.id, subject_id: input.subjectId, year_id: input.yearId, label: name, source_format: "earlier", found_count: input.ids.length, imported_count: input.ids.length })
    .select("id")
    .single();
  if (error) return fail(error, "banks.name_earlier");
  let moved = 0;
  for (const part of chunks(input.ids)) {
    // Only questions still without a bank: never pull a question out of a bank someone named.
    const { error: e, count } = await supabase.from("questions").update({ upload_id: data.id }, { count: "exact" }).in("id", part).is("upload_id", null);
    if (e) return fail(e, "banks.name_earlier");
    moved += count ?? 0;
  }
  revalidatePath("/teach/questions");
  return ok(`Saved as the bank “${name}” (${moved} question${moved === 1 ? "" : "s"}).`, { moved });
}

/** Sets (or clears) the topic on the ticked questions. */
export async function setTopicFor(ids: string[], topic: string): Promise<ActionResult> {
  await requireStaff();
  if (!ids.length) return fail("Tick the questions first.");
  const t = topic.trim().slice(0, 200) || null;
  const supabase = await createClient();
  let done = 0;
  for (const part of chunks([...new Set(ids)].slice(0, 5000))) {
    const { error, count } = await supabase.from("questions").update({ topic: t }, { count: "exact" }).in("id", part);
    if (error) return fail(error, "questions.set_topic");
    done += count ?? 0;
  }
  revalidatePath("/teach/questions");
  return ok(t ? `Topic “${t}” set on ${done} question${done === 1 ? "" : "s"}.` : `Topic cleared on ${done} question${done === 1 ? "" : "s"}.`);
}

/**
 * Questions first: makes a new test straight from the ticked questions (or a whole bank) and opens it,
 * with those questions already in. The teacher then only sets the time, marks and instructions.
 */
export async function makeTestFromQuestions(input: { ids?: string[]; bankId?: string; subjectId: string; yearId: string }): Promise<ActionResult> {
  const staff = await requireStaff();
  const s = await getStructure();
  const supabase = await createClient();
  const subject = s.subjectById.get(input.subjectId);
  const year = s.yearById.get(input.yearId);
  if (!subject || !year) return fail("Choose a subject and year group first.");
  if (!s.currentTerm) return fail("No current term is set. Ask the super admin.");

  let ids = input.ids ?? [];
  if (input.bankId) {
    for (let from = 0; ; from += 1000) {
      const { data } = await supabase.from("questions").select("id").eq("upload_id", input.bankId).eq("archived", false).order("created_at").range(from, from + 999);
      ids.push(...(data ?? []).map((r) => r.id as string));
      if (!data || data.length < 1000) break;
    }
  }
  ids = [...new Set(ids)];
  const info = (await questionsInfo(supabase, ids)).filter((q) => q.subject_id === subject.id && (!q.year_id || q.year_id === year.id));
  if (!info.length) return fail("None of these questions are for this subject and year group.");

  // The classes: the teacher's approved classes in this year (all of them for the Head of Section).
  const adminHere = staff.isSuperAdmin || (staff.isAdmin && staff.sectionIds.includes(subject.section_id));
  let classIds: string[];
  if (adminHere) classIds = s.classes.filter((c) => c.active && c.year_id === year.id).map((c) => c.id);
  else {
    const { data } = await supabase
      .from("teaching_assignments")
      .select("class_id")
      .eq("teacher_id", staff.id)
      .eq("subject_id", subject.id)
      .eq("session_id", s.currentSessionId ?? "")
      .eq("status", "approved");
    classIds = (data ?? []).map((r) => r.class_id as string).filter((c) => s.classById.get(c)?.year_id === year.id);
  }
  if (!classIds.length) return fail(`Your ${subject.name} classes in ${year.name} haven't been approved yet, so a test can't be made. Your questions are saved.`);

  // The round: the one all the questions share, else the school's default round.
  const rounds = await getRoundConfigs();
  const roundIds = [...new Set(info.map((q) => q.round_id).filter(Boolean))];
  const round = (roundIds.length === 1 ? rounds.find((r) => r.id === roundIds[0]) : null) ?? rounds.find((r) => r.is_default && r.is_active) ?? null;
  const d = round ? roundDefaults(round) : { type: "test" as const, questions: TYPE_DEFAULTS.test.questions, minutes: TYPE_DEFAULTS.test.minutes };

  const { data: paper, error } = await supabase
    .from("assessments")
    .insert({
      subject_id: subject.id,
      year_id: year.id,
      term_id: s.currentTerm.id,
      type: d.type,
      title: `${subject.name} — ${round?.label ?? TYPE_DEFAULTS[d.type].label}`.slice(0, 200),
      question_count: d.questions,
      duration_minutes: d.minutes,
      settings: { ...DEFAULT_SETTINGS, require_all_answered: d.type === "exam" || d.type === "mock" },
      class_ids: classIds,
      created_by: staff.id,
      ...(round ? { sequence_label: round.label, round_id: round.id } : {}),
    })
    .select("id")
    .single();
  if (error) return fail(error, "tests.from_questions");
  const ordered = info.sort((x, y) => x.created_at.localeCompare(y.created_at));
  for (const [n, part] of chunks(ordered).entries()) {
    const { error: e } = await supabase
      .from("assessment_questions")
      .insert(part.map((q, i) => ({ assessment_id: paper.id, question_id: q.id, position: n * CHUNK + i + 1 })));
    if (e) return fail(e, "tests.from_questions");
  }
  revalidatePath("/teach/papers");
  redirect(`/teach/assessments/${paper.id}?from=bank&added=${info.length}${input.bankId ? `&bank=${input.bankId}` : ""}`);
}

/** Adds N random questions from one bank (or the paper's round) that aren't in the test yet. */
export async function addRandomFromBank(input: { assessmentId: string; bankId: string; count: number }): Promise<ActionResult> {
  await requireStaff();
  const supabase = await createClient();
  const n = Math.max(1, Math.min(500, Math.floor(input.count)));
  const { data: a } = await supabase.from("assessments").select("subject_id, year_id").eq("id", input.assessmentId).maybeSingle();
  if (!a) return fail("Test not found.");
  const { data: inTest } = await supabase.from("assessment_questions").select("question_id, position").eq("assessment_id", input.assessmentId);
  const have = new Set((inTest ?? []).map((r) => r.question_id as string));
  let q = supabase.from("questions").select("id").eq("subject_id", a.subject_id).eq("archived", false).or(`year_id.eq.${a.year_id},year_id.is.null`);
  q = input.bankId === "none" ? q.is("upload_id", null) : q.eq("upload_id", input.bankId);
  const { data: pool } = await q.limit(5000);
  const available = (pool ?? []).map((r) => r.id as string).filter((id) => !have.has(id));
  if (!available.length) return fail("Every question in that bank is already in this test.");
  for (let i = available.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [available[i], available[j]] = [available[j], available[i]];
  }
  const pick = available.slice(0, n);
  const base = Math.max(0, ...(inTest ?? []).map((r) => Number(r.position) || 0));
  const { error } = await supabase.from("assessment_questions").insert(pick.map((id, i) => ({ assessment_id: input.assessmentId, question_id: id, position: base + i + 1 })));
  if (error) return fail(error, "tests.add_random");
  revalidatePath(`/teach/assessments/${input.assessmentId}`);
  return ok(`Added ${pick.length} question${pick.length === 1 ? "" : "s"} at random${pick.length < n ? ` (that's all that bank had left)` : ""}.`);
}

/** Removes the ticked questions from a test (they stay in the bank). */
export async function removeFromTest(assessmentId: string, ids: string[]): Promise<ActionResult> {
  await requireStaff();
  if (!ids.length) return fail("Tick the questions to remove.");
  const supabase = await createClient();
  let done = 0;
  for (const part of chunks(ids)) {
    const { error, count } = await supabase.from("assessment_questions").delete({ count: "exact" }).eq("assessment_id", assessmentId).in("question_id", part);
    if (error) return fail(error, "tests.remove_questions");
    done += count ?? 0;
  }
  revalidatePath(`/teach/assessments/${assessmentId}`);
  return ok(`Removed ${done} question${done === 1 ? "" : "s"} from this test. They're still in your bank.`);
}

/** The teacher marks a reviewer's comment on a question as fixed (or reopens it). */
export async function setCommentFixed(commentId: string, fixed: boolean): Promise<ActionResult> {
  await requireStaff();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("review_comments")
    .update({ resolved_at: fixed ? new Date().toISOString() : null })
    .eq("id", commentId)
    .select("assessment_id")
    .maybeSingle();
  if (error) return fail(error, "review.comment_fixed");
  if (!data) return fail("That comment couldn't be changed.");
  revalidatePath(`/teach/assessments/${data.assessment_id}`);
  return ok(fixed ? "Marked fixed." : "Reopened.");
}
