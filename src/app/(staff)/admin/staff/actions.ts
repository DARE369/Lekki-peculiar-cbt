"use server";

import { randomBytes } from "node:crypto";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { requireSuperAdmin } from "@/lib/auth";
import { fail, ok, str, type ActionResult } from "@/lib/actions";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { PERMISSIONS, type Permission, type StaffRole } from "@/lib/types";

function tempPassword() {
  // Readable: no 0/O/1/l confusion.
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  const bytes = randomBytes(12);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

function parseAccess(fd: FormData) {
  const role = str(fd, "role") as StaffRole;
  if (!["super_admin", "admin", "teacher"].includes(role)) return null;
  const sections = fd.getAll("section_id").map(String);
  const permissions = fd.getAll("permission").map(String).filter((p): p is Permission => p in PERMISSIONS);
  return { role, sections: role === "admin" ? sections : [], permissions: role === "super_admin" ? [] : permissions };
}

export async function createStaff(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const me = await requireSuperAdmin();
  const email = str(fd, "email").toLowerCase();
  const fullName = str(fd, "full_name");
  const access = parseAccess(fd);
  if (!email || !fullName || !access) return fail("Name, email and role are required.");
  const admin = createAdminClient();
  const method = str(fd, "method");

  let userId: string;
  let password: string | null = null;
  if (method === "invite") {
    const h = await headers();
    const origin = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("x-forwarded-host") ?? h.get("host")}`;
    const { data, error } = await admin.auth.admin.inviteUserByEmail(email, { redirectTo: `${origin}/auth/callback?next=/account` });
    if (error || !data.user) return fail(error?.message ?? "Could not send the invitation.");
    userId = data.user.id;
  } else {
    password = tempPassword();
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (error || !data.user) return fail(error?.message.includes("already") ? "An account with that email already exists." : (error?.message ?? "Failed"));
    userId = data.user.id;
  }

  const { error } = await admin.from("staff").insert({ id: userId, school_id: me.schoolId, email, full_name: fullName, role: access.role });
  if (error) return fail(error);
  if (access.sections.length) await admin.from("admin_sections").insert(access.sections.map((section_id) => ({ staff_id: userId, section_id })));
  if (access.permissions.length) {
    await admin.from("staff_permissions").insert(access.permissions.map((permission) => ({ staff_id: userId, permission, granted_by: me.id })));
  }
  await admin.from("audit_log").insert({ actor_id: me.id, action: "staff.created", entity: "staff", entity_id: userId, detail: { email, role: access.role } });
  revalidatePath("/admin/staff");
  return ok(
    password
      ? `${fullName} added. Temporary password: ${password} — give it to them privately; they can change it under My account.`
      : `${fullName} added and an invitation email was sent.`,
  );
}

export async function updateStaffAccess(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const me = await requireSuperAdmin();
  const id = str(fd, "id");
  const access = parseAccess(fd);
  if (!access) return fail("Choose a role.");
  if (id === me.id && access.role !== "super_admin") return fail("You can't remove your own super admin role.");
  const supabase = await createClient();
  const active = fd.get("active") === "on";
  if (id === me.id && !active) return fail("You can't deactivate yourself.");
  const { error } = await supabase.from("staff").update({ role: access.role, active, full_name: str(fd, "full_name") }).eq("id", id);
  if (error) return fail(error);
  await supabase.from("admin_sections").delete().eq("staff_id", id);
  if (access.sections.length) await supabase.from("admin_sections").insert(access.sections.map((section_id) => ({ staff_id: id, section_id })));
  await supabase.from("staff_permissions").delete().eq("staff_id", id);
  if (access.permissions.length) {
    await supabase.from("staff_permissions").insert(access.permissions.map((permission) => ({ staff_id: id, permission, granted_by: me.id })));
  }
  await supabase.rpc("log_audit", {
    p_action: "staff.updated",
    p_entity: "staff",
    p_entity_id: id,
    p_detail: { role: access.role, sections: access.sections, permissions: access.permissions, active },
  });
  revalidatePath(`/admin/staff/${id}`);
  revalidatePath("/admin/staff");
  return ok("Access updated.");
}

export async function resetStaffPassword(_: ActionResult, fd: FormData): Promise<ActionResult> {
  await requireSuperAdmin();
  const password = tempPassword();
  const { error } = await createAdminClient().auth.admin.updateUserById(str(fd, "id"), { password });
  if (error) return fail(error.message);
  return ok(`New temporary password: ${password}`);
}

// ---------------------------------------------------------------------------
// Sessions & terms, sections
// ---------------------------------------------------------------------------
export async function createSession(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const me = await requireSuperAdmin();
  const name = str(fd, "name");
  if (!/^\d{4}\/\d{4}$/.test(name)) return fail("Use the format 2027/2028.");
  const supabase = await createClient();
  const { data, error } = await supabase.from("academic_sessions").insert({ school_id: me.schoolId, name }).select("id").single();
  if (error) return fail(error);
  await supabase.from("terms").insert([
    { session_id: data.id, name: "First Term", ordinal: 1 },
    { session_id: data.id, name: "Second Term", ordinal: 2 },
    { session_id: data.id, name: "Third Term", ordinal: 3 },
  ]);
  revalidatePath("/admin/school");
  return ok(`${name} created with three terms.`);
}

export async function setCurrentTerm(fd: FormData) {
  await requireSuperAdmin();
  const supabase = await createClient();
  await supabase.rpc("set_current_term", { p_term: str(fd, "term_id") });
  revalidatePath("/", "layout");
}

export async function updateSection(_: ActionResult, fd: FormData): Promise<ActionResult> {
  await requireSuperAdmin();
  const supabase = await createClient();
  const { error } = await supabase
    .from("sections")
    .update({ name: str(fd, "name"), logo_url: str(fd, "logo_url") || null, cbt_enabled: fd.get("cbt_enabled") === "on" })
    .eq("id", str(fd, "id"));
  if (error) return fail(error);
  revalidatePath("/admin/school");
  return ok("Saved.");
}
