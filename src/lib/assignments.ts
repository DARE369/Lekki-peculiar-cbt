import "server-only";
import type { Structure } from "@/lib/data";
import { homeSectionOf, setHomeSection } from "@/lib/sections";
import { createClient } from "@/lib/supabase/server";

export type PickerSection = {
  id: string;
  name: string;
  subjects: { id: string; name: string }[];
  classes: { id: string; name: string }[];
};

/** Every CBT section with its active subjects and classes, for the subject/class picker. */
export function pickerSections(s: Structure, onlySection?: string | null): PickerSection[] {
  return s.sections
    .filter((x) => x.cbt_enabled && (!onlySection || x.id === onlySection))
    .map((sec) => ({
      id: sec.id,
      name: sec.name,
      subjects: s.subjects.filter((x) => x.active && x.section_id === sec.id).map((x) => ({ id: x.id, name: x.name })),
      classes: s.classes.filter((c) => c.active && s.sectionOfClass(c.id)?.id === sec.id).map((c) => ({ id: c.id, name: c.name })),
    }));
}

/** The teacher's current choices, as "subjectId:classId" keys: pending (editable) and approved (locked). */
export async function myPicks(teacherId: string, s: Structure) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("teaching_assignments")
    .select("subject_id, class_id, status")
    .eq("teacher_id", teacherId)
    .eq("session_id", s.currentSessionId ?? "");
  const key = (r: { subject_id: string; class_id: string }) => `${r.subject_id}:${r.class_id}`;
  return {
    pending: (data ?? []).filter((r) => r.status === "requested").map(key),
    approved: (data ?? []).filter((r) => r.status === "approved").map(key),
  };
}

/**
 * Saves the picker: new choices become requests for the Head of Section; pending choices that were
 * unticked are withdrawn. Approved ones are never touched. Returns an error message or null.
 */
export async function applySubjectPicks(teacherId: string, s: Structure, picksRaw: string[]): Promise<string | null> {
  if (!s.currentSessionId) return "The school year hasn't been set up yet. Please contact the school office.";
  const picks = new Set(picksRaw);
  const rows: { subject_id: string; class_id: string }[] = [];
  for (const p of picks) {
    const [subjectId, classId] = p.split(":");
    const subject = s.subjectById.get(subjectId);
    if (!subject || !s.classById.has(classId) || s.sectionOfClass(classId)?.id !== subject.section_id) continue;
    rows.push({ subject_id: subjectId, class_id: classId });
  }
  // A teacher belongs to one section: Elementary or College, never both.
  const picked = new Set(rows.map((r) => s.subjectById.get(r.subject_id)!.section_id));
  if (picked.size > 1) return "Choose subjects from one section only. A teacher belongs to either Elementary or College.";
  const home = await homeSectionOf(teacherId);
  const [only] = [...picked];
  if (home && only && only !== home) {
    const name = s.sectionById.get(home)?.name ?? "your section";
    return `You belong to ${name}, so please choose subjects and classes from ${name}.`;
  }
  const supabase = await createClient();
  const { data: existing } = await supabase
    .from("teaching_assignments")
    .select("id, subject_id, class_id, status")
    .eq("teacher_id", teacherId)
    .eq("session_id", s.currentSessionId);
  const withdraw = (existing ?? []).filter((r) => r.status === "requested" && !picks.has(`${r.subject_id}:${r.class_id}`)).map((r) => r.id);
  if (withdraw.length) await supabase.from("teaching_assignments").delete().in("id", withdraw);
  if (rows.length) {
    const { error } = await supabase.from("teaching_assignments").upsert(
      rows.map((r) => ({ ...r, teacher_id: teacherId, session_id: s.currentSessionId, status: "requested" })),
      { onConflict: "teacher_id,subject_id,class_id,session_id", ignoreDuplicates: true },
    );
    if (error) return error.message;
    if (!home && only) await setHomeSection(teacherId, only);
  }
  return null;
}
