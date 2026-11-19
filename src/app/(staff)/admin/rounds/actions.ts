"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { bool, fail, int, ok, str, type ActionResult } from "@/lib/actions";
import { getStructure } from "@/lib/data";
import { canManageRound } from "@/lib/rounds";
import { createAdminClient } from "@/lib/supabase/server";

// Rounds are written with the service role, so every action checks who may change what first:
// super admins manage every round; Heads of Section manage rounds limited to their own sections.

type Row = { id: string; label: string; is_active: boolean; is_default: boolean; section_ids: string[] | null };

async function loadRound(id: string) {
  const { data } = await createAdminClient().from("ca_round_configs").select("id, label, is_active, is_default, section_ids").eq("id", id).maybeSingle();
  return data as Row | null;
}

async function guard(id: string) {
  const staff = await requireAdmin();
  const row = await loadRound(id);
  if (!row) return { error: "Round not found." } as const;
  if (!canManageRound(staff, { section_ids: row.section_ids ?? [] })) {
    return { error: "Only the super admin can change rounds used by the whole school." } as const;
  }
  return { row, staff } as const;
}

function settingsFrom(fd: FormData) {
  const kind = str(fd, "kind");
  const qc = int(fd, "question_count", 0);
  const mins = int(fd, "duration_minutes", 0);
  return {
    kind: kind === "test" || kind === "exam" ? kind : null,
    counts_to_result: !bool(fd, "practice"),
    question_count: qc >= 1 && qc <= 200 ? qc : null,
    duration_minutes: mins >= 1 && mins <= 600 ? mins : null,
  };
}

export async function createRound(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const staff = await requireAdmin();
  const s = await getStructure();
  const label = str(fd, "label").slice(0, 30);
  if (!label) return fail("Give the round a name.");
  let sections = fd.getAll("section_id").map(String).filter((id) => s.sections.some((x) => x.id === id));
  if (!staff.isSuperAdmin) {
    // A Head of Section's rounds are for their own sections (all of them if none ticked).
    sections = sections.filter((id) => staff.sectionIds.includes(id));
    if (sections.length === 0) sections = staff.sectionIds;
    if (sections.length === 0) return fail("You don't head a section, so you can't add rounds.");
  }
  const db = createAdminClient();
  const { data: existing } = await db.from("ca_round_configs").select("id").ilike("label", label).maybeSingle();
  if (existing) return fail(`"${label}" already exists. Use it, or choose another name.`);
  const { data: last } = await db.from("ca_round_configs").select("sort_order").order("sort_order", { ascending: false }).limit(1).maybeSingle();
  const { error } = await db
    .from("ca_round_configs")
    .insert({ label, sort_order: (last?.sort_order ?? 0) + 1, section_ids: sections, created_by: staff.id, ...settingsFrom(fd) });
  if (error) return fail(error, "rounds.create");
  revalidatePath("/admin/rounds");
  return ok(`"${label}" added.`);
}

export async function updateRound(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const g = await guard(str(fd, "id"));
  if ("error" in g) return fail(g.error!);
  const label = str(fd, "label").slice(0, 30) || g.row.label;
  const db = createAdminClient();
  if (label.toLowerCase() !== g.row.label.toLowerCase()) {
    const { data: clash } = await db.from("ca_round_configs").select("id").ilike("label", label).maybeSingle();
    if (clash) return fail(`"${label}" already exists.`);
  }
  const s = await getStructure();
  let sections = fd.getAll("section_id").map(String).filter((id) => s.sections.some((x) => x.id === id));
  if (!g.staff.isSuperAdmin) {
    sections = sections.filter((id) => g.staff.sectionIds.includes(id));
    if (sections.length === 0) sections = g.row.section_ids ?? [];
  }
  const { error } = await db.from("ca_round_configs").update({ label, section_ids: sections, ...settingsFrom(fd) }).eq("id", g.row.id);
  if (error) return fail(error, "rounds.update");
  // Papers made before round ids were stored find their round by label: keep those labels in step.
  if (label !== g.row.label) await db.from("assessments").update({ sequence_label: label }).eq("sequence_label", g.row.label).is("round_id", null);
  revalidatePath("/admin/rounds");
  return ok("Saved.");
}

export async function deleteRound(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const g = await guard(str(fd, "id"));
  if ("error" in g) return fail(g.error!);
  const db = createAdminClient();
  const [{ count: byLabel }, { count: byId }, { count: qs }] = await Promise.all([
    db.from("assessments").select("id", { count: "exact", head: true }).eq("sequence_label", g.row.label),
    db.from("assessments").select("id", { count: "exact", head: true }).eq("round_id", g.row.id),
    db.from("questions").select("id", { count: "exact", head: true }).eq("round_id", g.row.id),
  ]);
  const used = (byLabel ?? 0) + (byId ?? 0) + (qs ?? 0);
  if (used > 0) return fail(`"${g.row.label}" is used by tests or questions. Hide it instead, so it stays in old records.`);
  const { error } = await db.from("ca_round_configs").delete().eq("id", g.row.id);
  if (error) return fail(error, "rounds.delete");
  revalidatePath("/admin/rounds");
  return ok(`"${g.row.label}" deleted.`);
}

export async function toggleRoundActive(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const g = await guard(str(fd, "id"));
  if ("error" in g) return fail(g.error!);
  if (g.row.is_default && g.row.is_active) return fail("This is the default round. Make another round the default first.");
  const { error } = await createAdminClient().from("ca_round_configs").update({ is_active: !g.row.is_active }).eq("id", g.row.id);
  if (error) return fail(error, "rounds.toggle");
  revalidatePath("/admin/rounds");
  return ok(g.row.is_active ? `"${g.row.label}" hidden from teachers.` : `"${g.row.label}" shown to teachers.`);
}

export async function setDefaultRound(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const staff = await requireAdmin();
  if (!staff.isSuperAdmin) return fail("Only the super admin chooses the default round.");
  const row = await loadRound(str(fd, "id"));
  if (!row) return fail("Round not found.");
  if (!row.is_active) return fail("Show the round before making it the default.");
  const db = createAdminClient();
  await db.from("ca_round_configs").update({ is_default: false }).eq("is_default", true);
  const { error } = await db.from("ca_round_configs").update({ is_default: true }).eq("id", row.id);
  if (error) return fail(error, "rounds.default");
  revalidatePath("/admin/rounds");
  return ok(`"${row.label}" is now the default.`);
}

export async function moveRound(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const staff = await requireAdmin();
  if (!staff.isSuperAdmin) return fail("Only the super admin changes the order of rounds.");
  const id = str(fd, "id");
  const direction = str(fd, "direction");
  const db = createAdminClient();
  const { data: rows } = await db.from("ca_round_configs").select("id, sort_order").order("sort_order");
  if (!rows) return fail("Could not load rounds.");
  const idx = rows.findIndex((r) => r.id === id);
  if (idx < 0) return fail("Round not found.");
  const swapIdx = direction === "up" ? idx - 1 : idx + 1;
  if (swapIdx < 0 || swapIdx >= rows.length) return ok("Already at the edge.");
  await db.from("ca_round_configs").update({ sort_order: rows[swapIdx].sort_order }).eq("id", rows[idx].id);
  await db.from("ca_round_configs").update({ sort_order: rows[idx].sort_order }).eq("id", rows[swapIdx].id);
  revalidatePath("/admin/rounds");
  return ok("Order updated.");
}
