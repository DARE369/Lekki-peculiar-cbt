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
