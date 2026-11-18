"use server";

import { revalidatePath } from "next/cache";
import { requireSuperAdmin } from "@/lib/auth";
import { fail, ok, str, type ActionResult } from "@/lib/actions";
import { createAdminClient } from "@/lib/supabase/server";

export async function createRound(_: ActionResult, fd: FormData): Promise<ActionResult> {
  await requireSuperAdmin();
  const label = str(fd, "label").trim().slice(0, 30);
  if (!label) return fail("Give the round a label.");
  const db = createAdminClient();
  const { data: existing } = await db.from("ca_round_configs").select("id").eq("label", label).maybeSingle();
  if (existing) return fail(`"${label}" already exists.`);
  const { data: last } = await db.from("ca_round_configs").select("sort_order").order("sort_order", { ascending: false }).limit(1).maybeSingle();
  const sort_order = (last?.sort_order ?? 0) + 1;
  const { error } = await db.from("ca_round_configs").insert({ label, sort_order });
  if (error) return fail(error.message);
  revalidatePath("/admin/rounds");
  return ok(`"${label}" added.`);
}

export async function deleteRound(_: ActionResult, fd: FormData): Promise<ActionResult> {
  await requireSuperAdmin();
  const id = str(fd, "id");
  const db = createAdminClient();
  // Don't delete if any assessments reference this label.
  const { data: row } = await db.from("ca_round_configs").select("label").eq("id", id).maybeSingle();
  if (!row) return fail("Round not found.");
  const { count } = await db.from("assessments").select("id", { count: "exact", head: true }).eq("sequence_label", row.label);
  if (count && count > 0) return fail(`${count} test${count === 1 ? "" : "s"} use "${row.label}" — deactivate it instead of deleting.`);
  const { error } = await db.from("ca_round_configs").delete().eq("id", id);
  if (error) return fail(error.message);
  revalidatePath("/admin/rounds");
  return ok(`"${row.label}" deleted.`);
}

export async function toggleRoundActive(_: ActionResult, fd: FormData): Promise<ActionResult> {
  await requireSuperAdmin();
  const id = str(fd, "id");
  const db = createAdminClient();
  const { data: row } = await db.from("ca_round_configs").select("label, is_active, is_default").eq("id", id).maybeSingle();
  if (!row) return fail("Round not found.");
  if (row.is_default && row.is_active) return fail("Can't deactivate the default round — set another round as default first.");
  const { error } = await db.from("ca_round_configs").update({ is_active: !row.is_active }).eq("id", id);
  if (error) return fail(error.message);
  revalidatePath("/admin/rounds");
  return ok(row.is_active ? `"${row.label}" hidden from teachers.` : `"${row.label}" shown to teachers.`);
}

export async function setDefaultRound(_: ActionResult, fd: FormData): Promise<ActionResult> {
  await requireSuperAdmin();
  const id = str(fd, "id");
  const db = createAdminClient();
  const { data: row } = await db.from("ca_round_configs").select("label, is_active").eq("id", id).maybeSingle();
  if (!row) return fail("Round not found.");
  if (!row.is_active) return fail("Can't set an inactive round as default.");
  // Clear existing default then set new one.
  await db.from("ca_round_configs").update({ is_default: false }).eq("is_default", true);
  const { error } = await db.from("ca_round_configs").update({ is_default: true }).eq("id", id);
  if (error) return fail(error.message);
  revalidatePath("/admin/rounds");
  return ok(`"${row.label}" is now the default.`);
}

export async function moveRound(_: ActionResult, fd: FormData): Promise<ActionResult> {
  await requireSuperAdmin();
  const id = str(fd, "id");
  const direction = str(fd, "direction") as "up" | "down";
  const db = createAdminClient();
  const { data: rows } = await db.from("ca_round_configs").select("id, sort_order").order("sort_order");
  if (!rows) return fail("Could not load rounds.");
  const idx = rows.findIndex((r) => r.id === id);
  if (idx < 0) return fail("Round not found.");
  const swapIdx = direction === "up" ? idx - 1 : idx + 1;
  if (swapIdx < 0 || swapIdx >= rows.length) return ok("Already at the edge.");
  const a = rows[idx];
  const b = rows[swapIdx];
  await db.from("ca_round_configs").update({ sort_order: b.sort_order }).eq("id", a.id);
  await db.from("ca_round_configs").update({ sort_order: a.sort_order }).eq("id", b.id);
  revalidatePath("/admin/rounds");
  return ok("Order updated.");
}
