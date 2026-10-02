"use server";

import { createHash, randomInt } from "node:crypto";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { redirect } from "next/navigation";
import { requireAdmin, can } from "@/lib/auth";
import { bool, fail, int, ok, str, type ActionResult } from "@/lib/actions";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { notifyAssessmentReview, notifyAssignmentDecisions, notifyBulkReview, type BulkDecision } from "@/lib/notify";
import { lagosLocalToIso } from "@/lib/time";

// ---------------------------------------------------------------------------
// Approvals & scheduling
// ---------------------------------------------------------------------------
export async function reviewAssessment(_: ActionResult, fd: FormData): Promise<ActionResult> {
  await requireAdmin();
  const id = str(fd, "id");
  const decision = str(fd, "decision");
  const note = str(fd, "note") || null;
  const supabase = await createClient();

  if (decision === "changes") {
    if (!note) return fail("Tell the teacher what to change.");
    const { error } = await supabase.rpc("review_assessment", { p_assessment: id, p_approve: false, p_note: note });
    if (error) return fail(error);
    after(() => notifyAssessmentReview(id, false, note));
    revalidatePath("/admin/approvals");
    redirect("/admin/approvals");
  }

  // Validate every scheduled class row before approving, so we don't approve and then fail.
  const rows = collectScheduleRows(fd);
  if (typeof rows === "string") return fail(rows);

  const { error } = await supabase.rpc("review_assessment", { p_assessment: id, p_approve: true, p_note: note });
  if (error) return fail(error);
  after(() => notifyAssessmentReview(id, true, note));
  for (const r of rows) {
    const { error: e } = await supabase.rpc("schedule_window", {
      p_assessment: id,
      p_class: r.classId,
      p_starts: r.starts,
      p_ends: r.ends,
      p_auto_start: r.autoStart,
    });
    if (e) return fail(`Approved, but scheduling failed: ${e.message}`);
  }
  revalidatePath("/admin/approvals");
  revalidatePath("/admin/exams");
  redirect(rows.length ? "/admin/exams" : `/admin/approvals/${id}`);
}

function collectScheduleRows(fd: FormData) {
  const classIds = fd.getAll("class_id").map(String);
  const rows: { classId: string; starts: string; ends: string; autoStart: boolean }[] = [];
  for (const classId of classIds) {
    const starts = lagosLocalToIso(str(fd, `starts_${classId}`) || str(fd, "starts_all"));
    const ends = lagosLocalToIso(str(fd, `ends_${classId}`) || str(fd, "ends_all"));
    if (!starts || !ends) return "Give a start and end time for every ticked class.";
    if (Date.parse(ends) <= Date.parse(starts)) return "End time must be after the start time.";
    rows.push({ classId, starts, ends, autoStart: bool(fd, "auto_start") });
  }
  return rows;
}

export async function scheduleClasses(_: ActionResult, fd: FormData): Promise<ActionResult> {
  await requireAdmin();
  const id = str(fd, "id");
  const rows = collectScheduleRows(fd);
  if (typeof rows === "string") return fail(rows);
  if (rows.length === 0) return fail("Tick at least one class.");
  const supabase = await createClient();
  for (const r of rows) {
    const { error } = await supabase.rpc("schedule_window", {
      p_assessment: id,
      p_class: r.classId,
      p_starts: r.starts,
      p_ends: r.ends,
      p_auto_start: r.autoStart,
    });
    if (error) return fail(error);
  }
  revalidatePath(`/admin/approvals/${id}`);
  revalidatePath("/admin/exams");
  return ok(`Scheduled ${rows.length} class${rows.length === 1 ? "" : "es"}.`);
}

// ---------------------------------------------------------------------------
// Bulk review
// ---------------------------------------------------------------------------
export type BulkReviewResult = { id: string; ok: boolean; error?: string };

/** Approve, approve-with-a-flag or send back many tests at once. Each test succeeds or fails on its own. */
export async function bulkReviewAction(items: BulkDecision[]): Promise<{ results: BulkReviewResult[] } | { error: string }> {
  const staff = await requireAdmin();
  if (!can(staff, "exam.approve")) return { error: "You need the permission to approve assessments." };
  if (!Array.isArray(items) || items.length === 0) return { error: "Nothing was chosen." };
  if (items.length > 200) return { error: "Please review at most 200 tests at a time." };
  const clean: BulkDecision[] = [];
  for (const i of items) {
    if (!i || typeof i.id !== "string" || !["approve", "flag", "send_back"].includes(i.action)) return { error: "That request was not valid." };
    clean.push({ id: i.id, action: i.action, category: i.category?.slice(0, 40), note: i.note?.trim().slice(0, 1000) });
  }
  const { data, error } = await (await createClient()).rpc("bulk_review", { p_items: clean });
  if (error) return { error: error.message };
  const results = (data ?? []) as BulkReviewResult[];
  const done = new Set(results.filter((r) => r.ok).map((r) => r.id));
  after(() => notifyBulkReview(clean.filter((c) => done.has(c.id))));
  revalidatePath("/admin/approvals");
  revalidatePath("/dashboard");
  return { results };
}

/** Accept a teacher's corrections to a flagged test, or close the flag without any change. */
export async function settleFlag(fd: FormData) {
  await requireAdmin();
  const id = str(fd, "id");
  const supabase = await createClient();
  const { error } = await supabase.rpc(str(fd, "decision") === "accept" ? "accept_amendment" : "resolve_flag", { p_assessment: id });
  revalidatePath("/admin/approvals");
  revalidatePath("/dashboard");
  if (error) redirect(`/admin/approvals?error=${encodeURIComponent(error.message)}`);
  redirect("/admin/approvals?settled=1");
}

export async function reopenAssessment(_: ActionResult, fd: FormData): Promise<ActionResult> {
  await requireAdmin();
  const note = str(fd, "note");
  if (!note) return fail("Say why it is being sent back.");
  const supabase = await createClient();
  const { error } = await supabase.rpc("reopen_assessment", { p_assessment: str(fd, "id"), p_note: note });
  if (error) return fail(error);
  revalidatePath("/admin/approvals");
  return ok("Sent back to the teacher for changes.");
}

// ---------------------------------------------------------------------------
// Live exam control
// ---------------------------------------------------------------------------
export async function windowAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  await requireAdmin();
  const id = str(fd, "window_id");
  const action = str(fd, "action");
  const newEnd = str(fd, "ends_at") ? lagosLocalToIso(str(fd, "ends_at")) : null;
  const supabase = await createClient();
  const { error } = await supabase.rpc("window_action", { p_window: id, p_action: action, p_ends_at: newEnd });
  if (error) return fail(error);
  revalidatePath(`/admin/exams/${id}`);
  const msg: Record<string, string> = {
    start: "Exam started — students can begin now.",
    resume: "Exam resumed.",
    pause: "Paused. No new students can start; those already writing keep going.",
    close: "Exam closed.",
  };
  return ok(msg[action]);
}

export async function extendTime(_: ActionResult, fd: FormData): Promise<ActionResult> {
  await requireAdmin();
  const id = str(fd, "window_id");
  const supabase = await createClient();
  const { error } = await supabase.rpc("extend_time", {
    p_window: id,
    p_minutes: int(fd, "minutes", 0),
    p_student: str(fd, "student_id") || null,
    p_reason: str(fd, "reason"),
  });
  if (error) return fail(error);
  revalidatePath(`/admin/exams/${id}`);
  return ok("Extra time added.");
}

export async function unlockRelogin(_: ActionResult, fd: FormData): Promise<ActionResult> {
  await requireAdmin();
  const id = str(fd, "window_id");
  const supabase = await createClient();
  const { error } = await supabase.rpc("unlock_relogin", {
    p_window: id,
    p_student: str(fd, "student_id"),
    p_reason: str(fd, "reason") || "Computer problem",
  });
  if (error) return fail(error);
  revalidatePath(`/admin/exams/${id}`);
  return ok("Unlocked. The student can now log in on another computer (once).");
}

export async function voidAttempt(_: ActionResult, fd: FormData): Promise<ActionResult> {
  await requireAdmin();
  const supabase = await createClient();
  const { error } = await supabase.rpc("void_attempt", { p_attempt: str(fd, "attempt_id"), p_reason: str(fd, "reason") });
  if (error) return fail(error);
  revalidatePath(`/admin/exams/${str(fd, "window_id")}`);
  return ok("Attempt voided. Grant a make-up if the student should sit it again.");
}

export async function grantMakeup(_: ActionResult, fd: FormData): Promise<ActionResult> {
  await requireAdmin();
  const opens = lagosLocalToIso(str(fd, "opens_at"));
  const closes = lagosLocalToIso(str(fd, "closes_at"));
  if (!opens || !closes) return fail("Give the make-up start and end times.");
  const studentIds = fd.getAll("student_id").map(String).filter(Boolean);
  if (studentIds.length === 0) return fail("Choose at least one student.");
  const supabase = await createClient();
  for (const sid of studentIds) {
    const { error } = await supabase.rpc("grant_makeup", {
      p_window: str(fd, "window_id"),
      p_student: sid,
      p_opens: opens,
      p_closes: closes,
      p_reason: str(fd, "reason"),
    });
    if (error) return fail(error);
  }
  revalidatePath(`/admin/exams/${str(fd, "window_id")}`);
  return ok(`Make-up granted to ${studentIds.length} student${studentIds.length === 1 ? "" : "s"}.`);
}

export async function deleteWindow(fd: FormData) {
  await requireAdmin();
  const supabase = await createClient();
  await supabase.rpc("delete_window", { p_window: str(fd, "window_id") });
  revalidatePath("/admin/exams");
  redirect("/admin/exams");
}

// ---------------------------------------------------------------------------
// Teaching assignments
// ---------------------------------------------------------------------------
export async function decideAssignment(fd: FormData) {
  await requireAdmin();
  const supabase = await createClient();
  const ids = fd.getAll("id").map(String);
  const decided: string[] = [];
  for (const id of ids) {
    const { error } = await supabase.rpc("decide_assignment", { p_assignment: id, p_approve: str(fd, "decision") === "approve" });
    if (!error) decided.push(id);
  }
  // One email per teacher, sent after the page has responded.
  after(() => notifyAssignmentDecisions(decided));
  revalidatePath("/admin/assignments");
  revalidatePath("/admin/progress");
}

export async function assignTeacher(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const staff = await requireAdmin();
  if (!can(staff, "teachers.manage")) return fail("You need the 'Approve teaching assignments' permission.");
  const supabase = await createClient();
  const { data: sess } = await supabase.from("academic_sessions").select("id").eq("is_current", true).maybeSingle();
  if (!sess) return fail("No current session.");
  const classIds = fd.getAll("class_id").map(String);
  if (!classIds.length) return fail("Tick at least one class.");
  const { data, error } = await supabase.from("teaching_assignments").upsert(
    classIds.map((c) => ({
      teacher_id: str(fd, "teacher_id"),
      subject_id: str(fd, "subject_id"),
      class_id: c,
      session_id: sess.id,
      status: "approved",
      decided_by: staff.id,
      decided_at: new Date().toISOString(),
    })),
    { onConflict: "teacher_id,subject_id,class_id,session_id" },
  ).select("id");
  if (error) return fail(error);
  after(() => notifyAssignmentDecisions((data ?? []).map((r) => r.id)));
  revalidatePath("/admin/assignments");
  return ok("Assigned. The teacher will get an email.");
}

export async function removeAssignment(fd: FormData) {
  await requireAdmin();
  const supabase = await createClient();
  await supabase.from("teaching_assignments").delete().eq("id", str(fd, "id"));
  revalidatePath("/admin/assignments");
}

// ---------------------------------------------------------------------------
// Classes & subjects (section admins)
// ---------------------------------------------------------------------------
export async function addClasses(_: ActionResult, fd: FormData): Promise<ActionResult> {
  await requireAdmin();
  const yearId = str(fd, "year_id");
  const names = str(fd, "names")
    .split(/[\n,]/)
    .map((n) => n.trim())
    .filter(Boolean);
  if (!yearId || names.length === 0) return fail("Choose a year and type at least one class name.");
  const supabase = await createClient();
  const { error } = await supabase
    .from("classes")
    .upsert(
      names.map((name) => ({ year_id: yearId, name, track_id: str(fd, "track_id") || null })),
      { onConflict: "year_id,name", ignoreDuplicates: true },
    );
  if (error) return fail(error);
  revalidatePath("/admin/classes");
  return ok(`Added ${names.length} class${names.length === 1 ? "" : "es"}.`);
}

/** One class per year, named after the year (e.g. "Year 4"), for years in the section that have no classes yet. */
export async function addYearClasses(_: ActionResult, fd: FormData): Promise<ActionResult> {
  await requireAdmin();
  const supabase = await createClient();
  const { data: years, error: e1 } = await supabase.from("years").select("id, name").eq("section_id", str(fd, "section_id"));
  if (e1) return fail(e1);
  const { data: existing, error: e2 } = await supabase.from("classes").select("year_id").in("year_id", (years ?? []).map((y) => y.id));
  if (e2) return fail(e2);
  const taken = new Set((existing ?? []).map((c) => c.year_id));
  const rows = (years ?? []).filter((y) => !taken.has(y.id)).map((y) => ({ year_id: y.id, name: y.name }));
  if (rows.length === 0) return ok("Every year already has a class.");
  const { error } = await supabase.from("classes").upsert(rows, { onConflict: "year_id,name", ignoreDuplicates: true });
  if (error) return fail(error);
  revalidatePath("/admin/classes");
  return ok(`Added ${rows.map((r) => r.name).join(", ")}.`);
}

export async function updateClass(_: ActionResult, fd: FormData): Promise<ActionResult> {
  await requireAdmin();
  const supabase = await createClient();
  const { error } = await supabase
    .from("classes")
    .update({ name: str(fd, "name"), track_id: str(fd, "track_id") || null, active: bool(fd, "active") })
    .eq("id", str(fd, "id"));
  if (error) return fail(error);
  revalidatePath("/admin/classes");
  return ok("Saved.");
}

export async function addSubject(_: ActionResult, fd: FormData): Promise<ActionResult> {
  await requireAdmin();
  const name = str(fd, "name");
  if (!name) return fail("Type a subject name.");
  const supabase = await createClient();
  const { error } = await supabase.from("subjects").insert({ section_id: str(fd, "section_id"), name });
  if (error) return fail(error);
  revalidatePath("/admin/classes");
  return ok(`${name} added.`);
}

/** Brings back every retired subject in a section (policies still limit who may change them). */
export async function restoreSubjects(fd: FormData) {
  await requireAdmin();
  const supabase = await createClient();
  await supabase.from("subjects").update({ active: true }).eq("section_id", str(fd, "section_id")).eq("active", false);
  revalidatePath("/admin/classes");
}

export async function toggleSubject(fd: FormData) {
  await requireAdmin();
  const supabase = await createClient();
  await supabase.from("subjects").update({ active: str(fd, "active") === "true" }).eq("id", str(fd, "id"));
  revalidatePath("/admin/classes");
}

// ---------------------------------------------------------------------------
// Lab terminals
// ---------------------------------------------------------------------------
export async function createTerminalCode(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const staff = await requireAdmin();
  if (!can(staff, "terminals.manage")) return fail("You need the 'Register lab computers' permission.");
  const hours = Math.min(72, Math.max(1, int(fd, "hours", 8)));
  const code = String(randomInt(0, 100_000_000)).padStart(8, "0");
  const admin = createAdminClient();
  const { error } = await admin.from("terminal_codes").insert({
    school_id: staff.schoolId,
    code_hash: createHash("sha256").update(code).digest("hex"),
    expires_at: new Date(Date.now() + hours * 3600_000).toISOString(),
    created_by: staff.id,
  });
  if (error) return fail(error);
  await admin.from("audit_log").insert({ actor_id: staff.id, action: "terminal.code_created", entity: "terminal_code", detail: { hours } });
  return ok(`Registration code: ${code.slice(0, 4)} ${code.slice(4)}  (valid for ${hours} hours)`);
}

export async function updateTerminal(fd: FormData) {
  await requireAdmin();
  const supabase = await createClient();
  const patch: Record<string, unknown> = {};
  if (fd.has("name")) patch.name = str(fd, "name");
  if (fd.has("active")) patch.active = str(fd, "active") === "true";
  await supabase.from("lab_terminals").update(patch).eq("id", str(fd, "id"));
  revalidatePath("/admin/terminals");
}
