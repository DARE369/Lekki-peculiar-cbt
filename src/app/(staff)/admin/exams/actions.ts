"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { fail, ok, str, type ActionResult } from "@/lib/actions";
import { createClient } from "@/lib/supabase/server";
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
      p_auto_start: false,
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
      p_auto_start: false,
    });
    if (error) return fail(`Could not schedule for one class: ${error.message}`);
  }
  revalidatePath("/admin/exams");
  revalidatePath("/dashboard");
  return ok(`Scheduled ${pairs.length} window${pairs.length === 1 ? "" : "s"}.`);
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
