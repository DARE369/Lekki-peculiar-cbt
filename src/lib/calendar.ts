import { getRoundConfigs } from "@/lib/data";
import { roundOf } from "@/lib/rounds";
import type { createClient } from "@/lib/supabase/server";

type Supabase = Awaited<ReturnType<typeof createClient>>;

export interface Slot {
  starts_at: string;
  ends_at: string;
}

/** The exam calendar's dates for this test's round, term and year group, if the Head of Section has set them. */
export async function calendarSlot(
  supabase: Supabase,
  a: { round_id?: string | null; sequence_label?: string | null; term_id: string; year_id: string },
): Promise<Slot | null> {
  const round = roundOf(a, await getRoundConfigs());
  if (!round) return null;
  const { data } = await supabase
    .from("round_schedules")
    .select("starts_at, ends_at")
    .eq("round_id", round.id)
    .eq("term_id", a.term_id)
    .eq("year_id", a.year_id)
    .maybeSingle();
  return (data as Slot | null) ?? null;
}

/**
 * After approval: if the test has no dates yet and the calendar has a slot for its round,
 * schedules the teacher's classes for that slot (starting automatically). Returns the slot used, or null.
 */
export async function scheduleFromCalendar(supabase: Supabase, assessmentId: string): Promise<{ slot: Slot; classes: number } | null> {
  const { data: a } = await supabase
    .from("assessments")
    .select("id, round_id, sequence_label, term_id, year_id, class_ids, status")
    .eq("id", assessmentId)
    .maybeSingle();
  if (!a || a.status !== "approved") return null;
  const { count } = await supabase.from("exam_windows").select("id", { count: "exact", head: true }).eq("assessment_id", assessmentId);
  if (count) return null;
  const slot = await calendarSlot(supabase, a);
  if (!slot || Date.parse(slot.ends_at) <= Date.now()) return null;
  let classIds = (a.class_ids ?? []) as string[];
  if (!classIds.length) {
    const { data } = await supabase.from("classes").select("id").eq("year_id", a.year_id).eq("active", true);
    classIds = (data ?? []).map((c) => c.id as string);
  }
  let done = 0;
  for (const c of classIds) {
    const { error } = await supabase.rpc("schedule_window", {
      p_assessment: assessmentId,
      p_class: c,
      p_starts: slot.starts_at,
      p_ends: slot.ends_at,
      p_auto_start: true,
    });
    if (!error) done++;
  }
  return done ? { slot, classes: done } : null;
}
