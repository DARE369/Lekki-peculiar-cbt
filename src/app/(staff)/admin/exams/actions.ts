"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { can, requireAdmin } from "@/lib/auth";
import { bool, fail, ok, str, type ActionResult } from "@/lib/actions";
import { createClient } from "@/lib/supabase/server";
import { getResultsOverride } from "@/lib/results-policy";
import { lagosLocalToIso } from "@/lib/time";

/** Set exam windows for an approved test from the Exams "Needs a date" view. */
export async function scheduleFromExamsPage(_prev: ActionResult | undefined, fd: FormData): Promise<ActionResult> {
  await requireAdmin();
  const supabase = await createClient();
  const assessmentId = str(fd, "assessment_id");
  if (!assessmentId) return fail("Missing assessment.");
  const classIds = fd.getAll("class_id").map(String);
  if (!classIds.length) return fail("Tick at least one class.");
  const starts = lagosLocalToIso(str(fd, "starts_all"));
  const ends = lagosLocalToIso(str(fd, "ends_all"));
  if (!starts) return fail("Pick an opening time.");
  if (!ends) return fail("Pick a closing time.");
  if (ends <= starts) return fail("Closing time must be after opening time.");

  for (const classId of classIds) {
    const { error } = await supabase.rpc("schedule_window", {
      p_assessment: assessmentId,
      p_class: classId,
      p_starts: starts,
      p_ends: ends,
      p_auto_start: !bool(fd, "manual_start"),
    });
    if (error) return fail(`Could not schedule for one class: ${error.message}`);
  }
  revalidatePath("/admin/exams");
  return ok("Scheduled.");
}

/** Schedule the same subject across multiple assessments and classes in one shot. */
export async function bulkScheduleBySubject(_prev: ActionResult | undefined, fd: FormData): Promise<ActionResult> {
  await requireAdmin();
  const supabase = await createClient();
  // Each "pair" is encoded as "assessmentId:classId"
  const pairs = fd.getAll("pair").map(String).filter(Boolean);
  if (!pairs.length) return fail("Select at least one class.");
  const starts = lagosLocalToIso(str(fd, "starts_all"));
  const ends = lagosLocalToIso(str(fd, "ends_all"));
  if (!starts) return fail("Pick an opening time.");
  if (!ends) return fail("Pick a closing time.");
  if (ends <= starts) return fail("Closing time must be after opening time.");

  let done = 0;
  for (const pair of pairs) {
    const colonIdx = pair.indexOf(":");
    if (colonIdx === -1) continue;
    const assessmentId = pair.slice(0, colonIdx);
    const classId = pair.slice(colonIdx + 1);
    const { error } = await supabase.rpc("schedule_window", {
      p_assessment: assessmentId,
      p_class: classId,
      p_starts: starts,
      p_ends: ends,
      p_auto_start: !bool(fd, "manual_start"),
    });
    if (error) {
      revalidatePath("/admin/exams");
      return fail(`${done ? `${done} scheduled, then it stopped: ` : "Could not schedule: "}${error.message}`);
    }
    done++;
  }
  revalidatePath("/admin/exams");
  revalidatePath("/dashboard");
  // Back to the same tab with a banner: once every test in a group has a date the group is gone from the
  // list, and a message inside it would disappear with it.
  const group = str(fd, "group") === "year" ? "year" : "subject";
  redirect(`/admin/exams?view=drafts&group=${group}&scheduled=${done}`);
}

/** Start (or pause/resume/close) multiple exam windows at once. */
export async function bulkWindowAction(windowIds: string[], action: string): Promise<ActionResult> {
  if (!windowIds.length || windowIds.length > 100) return fail("Invalid request.");
  await requireAdmin();
  const supabase = await createClient();
  let started = 0;
  const errors: string[] = [];
  for (const id of windowIds) {
    const { error } = await supabase.rpc("window_action", { p_window: id, p_action: action, p_ends_at: null });
    if (error) errors.push(error.message);
    else started++;
  }
  revalidatePath("/admin/exams");
  if (started === 0) return fail(errors[0] ?? "Could not start any exams.");
  const msg: Record<string, string> = {
    start: `Started ${started} exam${started === 1 ? "" : "s"}.`,
    pause: `Paused ${started} exam${started === 1 ? "" : "s"}.`,
    resume: `Resumed ${started} exam${started === 1 ? "" : "s"}.`,
    close: `Closed ${started} exam${started === 1 ? "" : "s"}.`,
  };
  return ok(msg[action] ?? `Done (${started}).`, { started, failed: errors.length });
}

// ---------------------------------------------------------------------------
// Controls for a whole group of exams at once (chosen by class on the Exams screen)
// ---------------------------------------------------------------------------
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function cleanIds(ids: unknown): string[] | null {
  if (!Array.isArray(ids)) return null;
  const out = [...new Set(ids.map(String))];
  if (!out.length || out.length > 100 || !out.every((x) => UUID.test(x))) return null;
  return out;
}
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Gives every chosen exam the same extra minutes (running students get them straight away). */
export async function bulkExtraTime(windowIds: string[], minutes: number, reason: string): Promise<ActionResult> {
  const staff = await requireAdmin();
  const ids = cleanIds(windowIds);
  if (!ids) return fail("Choose at least one exam (up to 100).");
  if (!can(staff, "exam.extend_time")) return fail("You don't have permission to give extra time.");
  const m = Math.floor(Number(minutes));
  if (!(m >= 1 && m <= 240)) return fail("Extra time must be between 1 and 240 minutes.");
  const why = String(reason ?? "").trim().slice(0, 200);
  if (!why) return fail("Say why, for the record (for example: power cut).");
  const supabase = await createClient();
  let done = 0;
  const errors: string[] = [];
  for (const id of ids) {
    const { error } = await supabase.rpc("extend_time", { p_window: id, p_minutes: m, p_student: null, p_reason: why });
    if (error) errors.push(error.message);
    else done++;
  }
  revalidatePath("/admin/exams", "layout");
  if (!done) return fail(errors[0] ?? "Nothing was changed.");
  return ok(`Added ${m} minutes to ${plural(done, "exam")}.${errors.length ? ` ${plural(errors.length, "exam")} couldn't be changed: ${errors[0]}` : ""}`, { done, failed: errors.length });
}

/** Hides or shows results from students for the chosen tests (a test is shared by all its classes). */
export async function bulkResultsHidden(assessmentIds: string[], hide: boolean): Promise<ActionResult> {
  const staff = await requireAdmin();
  const ids = cleanIds(assessmentIds);
  if (!ids) return fail("Choose at least one exam (up to 100).");
  if (!(can(staff, "exam.start") || can(staff, "exam.approve"))) return fail("You don't have permission to change this.");
  if (await getResultsOverride()) return fail("Results are set school-wide, which overrides this. Change it with the school-wide control first.");
  const supabase = await createClient();
  let done = 0;
  const errors: string[] = [];
  for (const id of ids) {
    const { error } = await supabase.rpc("set_results_hidden", { p_assessment: id, p_hidden: Boolean(hide) });
    if (error) errors.push(error.message);
    else done++;
  }
  revalidatePath("/admin/exams", "layout");
  if (!done) return fail(errors[0] ?? "Nothing was changed.");
  return ok(
    `${hide ? "Results hidden" : "Results shown"} for ${plural(done, "test")}. ${hide ? "Students see a congratulations message instead of their score." : "Students see their score after submitting."}${errors.length ? ` ${plural(errors.length, "test")} couldn't be changed: ${errors[0]}` : ""}`,
    { done, failed: errors.length },
  );
}

/** Sets the focus-leave penalty (minutes a student waits after leaving the exam screen; 0 = off) on the chosen exams. */
export async function bulkFocusPenalty(windowIds: string[], minutes: number): Promise<ActionResult> {
  const staff = await requireAdmin();
  const ids = cleanIds(windowIds);
  if (!ids) return fail("Choose at least one exam (up to 100).");
  if (!can(staff, "exam.start")) return fail("You don't have permission to change this.");
  const m = Math.floor(Number(minutes));
  if (!(m >= 0 && m <= 60)) return fail("Enter a value between 0 and 60 minutes.");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("set_focus_penalty", { p_windows: ids, p_minutes: m });
  if (error) {
    if (/set_focus_penalty/.test(error.message)) return fail("This needs a database update first. Ask whoever looks after the system to run the latest migration.");
    return fail(error, "exams.bulk_focus_penalty");
  }
  revalidatePath("/admin/exams", "layout");
  const n = Number(data ?? 0);
  if (!n) return fail("Nothing was changed.");
  return ok(m === 0 ? `Focus penalty turned off for ${plural(n, "exam")}.` : `Focus penalty set to ${m} minutes for ${plural(n, "exam")}.`, { done: n });
}
