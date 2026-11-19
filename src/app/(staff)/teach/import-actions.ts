"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireStaff } from "@/lib/auth";
import { getRoundConfigs, getStructure } from "@/lib/data";
import { roundOf } from "@/lib/rounds";
import { defaultBankName } from "@/lib/banks";
import { logError } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";
import { parsedQuestionSchema, questionFingerprint, type ParsedQuestion } from "@/lib/import/questions";

type Supabase = Awaited<ReturnType<typeof createClient>>;

export interface BankMatch {
  /** index in the list that was checked */
  index: number;
  existingId: string;
  /** the upload it came from, or null for questions added before uploads were tracked */
  uploadLabel: string | null;
  createdAt: string;
  /** already one of this test's questions */
  inTest: boolean;
}

type ExistingRow = { id: string; body: string; options: { text: string }[]; created_at: string; upload_id: string | null };

/**
 * The teacher's own questions for this subject that an upload should be compared with: same year group
 * (or questions with no year). Other teachers' questions and other year groups never count as duplicates.
 */
async function ownBank(supabase: Supabase, ownerId: string, subjectId: string, yearId: string | null) {
  const rows: ExistingRow[] = [];
  for (let from = 0; ; from += 1000) {
    let q = supabase
      .from("questions")
      .select("id, body, options, created_at, upload_id")
      .eq("owner_id", ownerId)
      .eq("subject_id", subjectId)
      .eq("archived", false)
      .order("created_at")
      .range(from, from + 999);
    if (yearId) q = q.or(`year_id.eq.${yearId},year_id.is.null`);
    const { data, error } = await q;
    if (error) throw error;
    rows.push(...((data ?? []) as ExistingRow[]));
    if (!data || data.length < 1000) break;
  }
  const byPrint = new Map<string, ExistingRow>();
  for (const r of rows) byPrint.set(questionFingerprint({ body: r.body, options: Array.isArray(r.options) ? r.options : [] }), r);
  return byPrint;
}

const checkSchema = z.object({
  subjectId: z.string().uuid(),
  yearId: z.string().uuid().nullable(),
  assessmentId: z.string().uuid().nullable(),
  questions: z.array(z.object({ body: z.string(), options: z.array(z.object({ text: z.string() })) })).max(1000),
});

/** Called while the teacher is checking the preview: which of these are already in their bank? */
export async function checkImportDuplicates(input: z.input<typeof checkSchema>): Promise<BankMatch[]> {
  const staff = await requireStaff();
  const parsed = checkSchema.safeParse(input);
  if (!parsed.success) return [];
  const { subjectId, yearId, assessmentId, questions } = parsed.data;
  const supabase = await createClient();
  const bank = await ownBank(supabase, staff.id, subjectId, yearId);
  if (bank.size === 0) return [];

  const hits = questions
    .map((q, index) => ({ index, row: bank.get(questionFingerprint(q)) }))
    .filter((h): h is { index: number; row: ExistingRow } => Boolean(h.row));
  if (hits.length === 0) return [];

  const uploadIds = [...new Set(hits.map((h) => h.row.upload_id).filter((x): x is string => Boolean(x)))];
  const labels = new Map<string, string>();
  if (uploadIds.length) {
    const { data } = await supabase.from("question_uploads").select("id, label").in("id", uploadIds);
    for (const u of data ?? []) labels.set(u.id as string, u.label as string);
  }
  const inTest = new Set<string>();
  if (assessmentId) {
    const { data } = await supabase
      .from("assessment_questions")
      .select("question_id")
      .eq("assessment_id", assessmentId)
      .in("question_id", hits.map((h) => h.row.id));
    for (const r of data ?? []) inTest.add(r.question_id as string);
  }
  return hits.map((h) => ({
    index: h.index,
    existingId: h.row.id,
    uploadLabel: h.row.upload_id ? (labels.get(h.row.upload_id) ?? null) : null,
    createdAt: h.row.created_at,
    inTest: inTest.has(h.row.id),
  }));
}

const issueSchema = z.object({
  code: z.string().max(40).optional(),
  source: z.string().max(200),
  message: z.string().max(600),
  excerpt: z.string().max(200).optional(),
});

const commitSchema = z.object({
  subjectId: z.string().uuid(),
  yearId: z.string().uuid().nullable(),
  assessmentId: z.string().uuid().nullable(),
  /** the round these questions are for (taken from the test when uploading into one) */
  roundId: z.string().uuid().nullable(),
  label: z.string().trim().max(80),
  fileName: z.string().max(200).nullable(),
  format: z.enum(["paste", "word", "excel", "csv", "json", "text"]).nullable(),
  questions: z.array(parsedQuestionSchema.extend({ forceNew: z.boolean().optional() })).max(1000),
  /** questions the teacher removed from the preview before importing */
  removedCount: z.number().int().min(0).max(5000),
  /** questions that couldn't be read, with the reason for each */
  unreadable: z.array(issueSchema).max(2000),
});

export type ImportReceipt = {
  uploadId: string;
  label: string;
  found: number;
  imported: number;
  /** already in the bank and now added to the test */
  linked: number;
  /** already in the bank and (no test, or already in it) so nothing to do */
  alreadyInBank: number;
  /** the same question twice in this file */
  duplicateInFile: number;
  removed: number;
  unreadable: number;
};

export type CommitResult = { ok: true; receipt: ImportReceipt } | { ok: false; error: string; ref?: string };

/** Friendly message for a failed save, plus a reference code that is also written to the server log. */
function saveFailed(err: unknown, context: Record<string, unknown>): CommitResult {
  const raw = err && typeof err === "object" && "message" in err ? String((err as { message: unknown }).message) : String(err);
  let error = "Your questions couldn't be saved. Nothing was saved, so you can safely try again.";
  if (raw.includes("can no longer be changed")) error = "This test has been submitted or approved, so questions can't be added to it. Nothing was saved.";
  else if (raw.includes("same section")) error = "That year group isn't in the same section as the subject. Choose the year group again. Nothing was saved.";
  else if (raw.includes("row-level security") || raw.includes("permission")) error = "You can only upload questions for subjects you teach (or have asked to teach). Nothing was saved.";
  else if (raw.includes("different subject")) error = "This test is for a different subject. Nothing was saved.";
  const ref = logError({ area: "questions.import", error: err, shown: error, detail: context });
  return { ok: false, error, ref };
}

export type CommitInput = Omit<z.input<typeof commitSchema>, "questions"> & { questions: (ParsedQuestion & { forceNew?: boolean })[] };

export async function commitImport(input: CommitInput): Promise<CommitResult> {
  const staff = await requireStaff();
  const parsed = commitSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Some of the questions weren't in a form we could save. Check the highlighted questions and try again." };
  }
  const { subjectId, yearId, assessmentId, fileName, format, questions, removedCount, unreadable } = parsed.data;
  const s = await getStructure();
  const subject = s.subjectById.get(subjectId);
  if (!subject) return { ok: false, error: "Choose a subject." };
  if (yearId && s.yearById.get(yearId)?.section_id !== subject.section_id) {
    return { ok: false, error: `That year group isn't in ${subject.name}'s section. Choose the year group again.` };
  }
  if (questions.length === 0 && unreadable.length === 0) return { ok: false, error: "There are no questions to import." };

  const supabase = await createClient();

  // Which round and term the questions belong to: the test's when uploading into one, else the teacher's choice.
  const rounds = await getRoundConfigs();
  let roundId = parsed.data.roundId;
  let termId = s.currentTerm?.id ?? null;
  if (assessmentId) {
    const { data: a } = await supabase.from("assessments").select("round_id, sequence_label, term_id").eq("id", assessmentId).maybeSingle();
    if (a) {
      roundId = roundOf(a, rounds)?.id ?? roundId;
      termId = a.term_id ?? termId;
    }
  } else if (!roundId) {
    return { ok: false, error: "Choose which round these questions are for (for example 1st CA or Exam)." };
  }
  if (roundId && !rounds.some((r) => r.id === roundId)) return { ok: false, error: "That round no longer exists. Choose another." };

  let bank: Map<string, ExistingRow>;
  try {
    bank = await ownBank(supabase, staff.id, subjectId, yearId);
  } catch (e) {
    return saveFailed(e, { step: "read bank", subjectId, yearId });
  }

  let inTest = new Set<string>();
  if (assessmentId) {
    const { data } = await supabase.from("assessment_questions").select("question_id").eq("assessment_id", assessmentId);
    inTest = new Set((data ?? []).map((r) => r.question_id as string));
  }

  const fresh: typeof questions = [];
  const link: string[] = [];
  let alreadyInBank = 0;
  let duplicateInFile = 0;
  const seen = new Set<string>();
  for (const q of questions) {
    const print = questionFingerprint(q);
    if (seen.has(print) && !q.forceNew) {
      duplicateInFile += 1;
      continue;
    }
    seen.add(print);
    const existing = q.forceNew ? undefined : bank.get(print);
    if (existing) {
      if (assessmentId && !inTest.has(existing.id)) link.push(existing.id);
      else alreadyInBank += 1;
      continue;
    }
    fresh.push(q);
  }

  const found = questions.length + removedCount + unreadable.length;
  const label = parsed.data.label || defaultBankName(subject.name, rounds.find((r) => r.id === roundId)?.label, new Date());
  const { data, error } = await supabase.rpc("import_questions", {
    p_upload: {
      subject_id: subjectId,
      year_id: yearId,
      assessment_id: assessmentId,
      round_id: roundId,
      term_id: termId,
      label,
      file_name: fileName,
      source_format: format,
      found_count: found,
      duplicate_count: alreadyInBank + link.length + duplicateInFile,
      removed_count: removedCount,
      unreadable_count: unreadable.length,
      issues: unreadable,
    },
    p_questions: fresh.map((q) => ({
      body: q.body,
      options: q.options,
      answer: q.answer,
      topic: q.topic,
      difficulty: q.difficulty,
      explanation: q.explanation,
      image_url: q.image_url,
    })),
    p_link_existing: link,
  });
  if (error) return saveFailed(error, { step: "save", subjectId, yearId, assessmentId, count: fresh.length });
  const result = data as { upload_id: string; imported: number; linked: number };

  revalidatePath("/teach/questions");
  if (assessmentId) revalidatePath(`/teach/assessments/${assessmentId}`);
  return {
    ok: true,
    receipt: {
      uploadId: result.upload_id,
      label,
      found,
      imported: result.imported,
      linked: result.linked,
      alreadyInBank: alreadyInBank + (link.length - result.linked),
      duplicateInFile,
      removed: removedCount,
      unreadable: unreadable.length,
    },
  };
}
