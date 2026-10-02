import "server-only";
import { createAdminClient, createClient } from "@/lib/supabase/server";

/**
 * Which section(s) each visible staff member belongs to: teachers have one "home" section, Heads of Section
 * the sections they manage. Row-level security already limits who is returned. If the database hasn't been
 * updated with staff sections yet, teachers simply show as having no section.
 */
export async function staffSectionMap(): Promise<Map<string, string[]>> {
  const supabase = await createClient();
  const [{ data: home }, { data: heads }] = await Promise.all([
    supabase.from("staff").select("id, home_section_id"),
    supabase.from("admin_sections").select("staff_id, section_id"),
  ]);
  const map = new Map<string, string[]>();
  const add = (id: string, section: string | null | undefined) => {
    if (!section) return;
    const list = map.get(id) ?? [];
    if (!list.includes(section)) map.set(id, [...list, section]);
  };
  for (const r of (home ?? []) as { id: string; home_section_id: string | null }[]) add(r.id, r.home_section_id);
  for (const r of heads ?? []) add(r.staff_id, r.section_id);
  return map;
}

/** The section one teacher belongs to, or null (also null if the database doesn't have the column yet). */
export async function homeSectionOf(staffId: string): Promise<string | null> {
  const { data } = await (await createClient()).from("staff").select("home_section_id").eq("id", staffId).maybeSingle();
  return (data as { home_section_id?: string | null } | null)?.home_section_id ?? null;
}

/** Sets (or clears) a teacher's section. Quietly does nothing if the database doesn't have the column yet. */
export async function setHomeSection(staffId: string, sectionId: string | null) {
  await createAdminClient().from("staff").update({ home_section_id: sectionId }).eq("id", staffId);
}
