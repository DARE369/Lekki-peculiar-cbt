"use server";

import { revalidatePath } from "next/cache";
import { can, requireAdmin } from "@/lib/auth";
import { fail, ok, str, type ActionResult } from "@/lib/actions";
import { getStructure } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";
import { lagosLocalToIso } from "@/lib/time";

/** Saves one round's exam days for each year group (fields starts_<year id> / ends_<year id>). Empty both to clear. */
export async function saveRoundCalendar(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const staff = await requireAdmin();
  if (!can(staff, "exam.approve")) return fail("You need the permission to approve exams to set the calendar.");
  const s = await getStructure();
  if (!s.currentTerm) return fail("No current term is set. Ask the super admin.");
  const roundId = str(fd, "round_id");
  const supabase = await createClient();
  let saved = 0;
  for (const yearId of fd.getAll("year_id").map(String)) {
    const name = s.yearById.get(yearId)?.name ?? "that year";
    const a = str(fd, `starts_${yearId}`);
    const b = str(fd, `ends_${yearId}`);
    if (!a && !b) {
      const { error } = await supabase.from("round_schedules").delete().eq("round_id", roundId).eq("term_id", s.currentTerm.id).eq("year_id", yearId);
      if (error) return fail(error, "calendar.clear");
      continue;
    }
    const starts = lagosLocalToIso(a);
    const ends = lagosLocalToIso(b);
    if (!starts || !ends) return fail(`Give both a start and an end for ${name}, or leave both empty.`);
    if (Date.parse(ends) <= Date.parse(starts)) return fail(`For ${name}, the end must be after the start.`);
    const { error } = await supabase
      .from("round_schedules")
      .upsert(
        { round_id: roundId, term_id: s.currentTerm.id, year_id: yearId, starts_at: starts, ends_at: ends, created_by: staff.id, updated_at: new Date().toISOString() },
        { onConflict: "round_id,term_id,year_id" },
      );
    if (error) return fail(error, "calendar.save");
    saved++;
  }
  revalidatePath("/admin/calendar");
  return ok(saved ? `Saved. Tests in this round will be dated automatically when you approve them.` : "Cleared.");
}
