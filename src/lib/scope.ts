import "server-only";
import type { StaffContext } from "@/lib/auth";
import type { Structure } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";
import type { Subject } from "@/lib/types";

/**
 * Subjects this staff member works with: ones they teach, plus their sections if admin.
 * With includeRequested, also subjects still waiting for approval — teachers may add questions
 * for those straight away (building tests still needs approval).
 */
export async function teachableSubjects(staff: StaffContext, s: Structure, opts: { includeRequested?: boolean } = {}): Promise<Subject[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("teaching_assignments")
    .select("subject_id")
    .eq("teacher_id", staff.id)
    .in("status", opts.includeRequested ? ["approved", "requested"] : ["approved"]);
  const ids = new Set((data ?? []).map((r) => r.subject_id as string));
  const cbtSectionIds = new Set(s.sections.filter((x) => x.cbt_enabled).map((x) => x.id));
  return s.subjects.filter(
    (sub) =>
      sub.active &&
      cbtSectionIds.has(sub.section_id) &&
      (ids.has(sub.id) || staff.isSuperAdmin || (staff.isAdmin && staff.sectionIds.includes(sub.section_id))),
  );
}

/** Class ids whose results this staff member may see. */
export async function visibleClassIds(staff: StaffContext, s: Structure): Promise<Set<string>> {
  if (staff.isSuperAdmin) return new Set(s.classes.map((c) => c.id));
  const supabase = await createClient();
  const { data } = await supabase
    .from("teaching_assignments")
    .select("class_id")
    .eq("teacher_id", staff.id)
    .eq("status", "approved");
  const ids = new Set((data ?? []).map((r) => r.class_id as string));
  if (staff.isAdmin) {
    for (const c of s.classes) if (staff.sectionIds.includes(s.sectionOfClass(c.id)?.id ?? "")) ids.add(c.id);
  }
  return ids;
}

/** For pick-lists: adds the section to subjects whose name appears in more than one section ("English Language (College)"). */
export function labelSubjects(subjects: Subject[], s: Structure): Subject[] {
  const count = new Map<string, number>();
  for (const x of subjects) count.set(x.name, (count.get(x.name) ?? 0) + 1);
  return subjects.map((x) => ((count.get(x.name) ?? 0) > 1 ? { ...x, name: `${x.name} (${s.sectionById.get(x.section_id)?.name ?? ""})` } : x));
}
