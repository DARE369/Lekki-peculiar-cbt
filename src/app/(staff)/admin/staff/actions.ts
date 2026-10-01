"use server";

import { randomBytes } from "node:crypto";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSuperAdmin, type StaffContext } from "@/lib/auth";
import { fail, ok, str, type ActionResult } from "@/lib/actions";
import { brand } from "@/lib/brand";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import type { StaffImportRow } from "@/lib/import/staff";
import { readSheetCells } from "@/lib/import/xlsx";
import { HOD_DEFAULT_PERMISSIONS, PERMISSIONS, type Permission, type StaffRole } from "@/lib/types";

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

async function findAuthUserId(admin: ReturnType<typeof createAdminClient>, email: string): Promise<string | null> {
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error || !data) return null;
    const hit = data.users.find((u) => u.email?.toLowerCase() === email);
    if (hit) return hit.id;
    if (data.users.length < 1000) return null;
  }
  return null;
}


type Admin = ReturnType<typeof createAdminClient>;

/** Creates (or reuses) the sign-in account for an email with the given password. */
async function createLoginWithPassword(admin: Admin, email: string, password: string): Promise<{ userId: string; reused: boolean } | { error: string }> {
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (data?.user) return { userId: data.user.id, reused: false };
  if (error && /already|registered|exists/i.test(error.message)) {
    // A sign-in account exists without a staff record (e.g. an earlier failed invite): reuse it.
    const userId = await findAuthUserId(admin, email);
    if (!userId) return { error: "Could not find the existing sign-in account for that email." };
    await admin.auth.admin.updateUserById(userId, { password, email_confirm: true });
    return { userId, reused: true };
  }
  return { error: error?.message ?? "Could not create the account." };
}

/** Writes the staff row, section scopes and permissions. Returns an error message, or null. */
async function saveStaffRecord(
  admin: Admin,
  me: StaffContext,
  a: { userId: string; email: string; fullName: string; role: StaffRole; sections: string[]; permissions: Permission[] },
): Promise<string | null> {
  const { error } = await admin.from("staff").insert({ id: a.userId, school_id: me.schoolId, email: a.email, full_name: a.fullName, role: a.role });
  if (error) return error.message;
  if (a.sections.length) await admin.from("admin_sections").insert(a.sections.map((section_id) => ({ staff_id: a.userId, section_id })));
  if (a.permissions.length) {
    await admin.from("staff_permissions").insert(a.permissions.map((permission) => ({ staff_id: a.userId, permission, granted_by: me.id })));
  }
  return null;
}

async function siteOrigin() {
  const h = await headers();
  return `${h.get("x-forwarded-proto") ?? "https"}://${h.get("x-forwarded-host") ?? h.get("host")}`;
}

/** Extra details the invitation email template can use: {{ .Data.first_name }}, {{ .Data.role }} etc. */
function inviteData(fullName: string, role: StaffRole, sectionNames: string[]) {
  const words = fullName.split(/\s+/).filter(Boolean);
  const titles = /^(mr|mrs|ms|miss|dr|prof|pastor|rev)\.?$/i;
  return {
    full_name: fullName,
    first_name: (titles.test(words[0] ?? "") ? words.slice(0, 2).join(" ") : words[0]) ?? fullName,
    role,
    role_label: role === "super_admin" ? "Super admin" : role === "admin" ? "Head of Section" : "Teacher",
    sections: sectionNames.join(", "),
    school: brand.schoolName,
  };
}

/**
 * Sends Supabase's invitation email (customise it under Authentication → Email Templates → Invite user; a ready-made
 * template is in docs/email-templates/invite.html). Returns the new sign-in account, or why it failed.
 */
async function inviteLogin(
  admin: Admin,
  email: string,
  data: ReturnType<typeof inviteData>,
): Promise<{ userId: string; reused: boolean } | { error: string; rateLimited?: boolean }> {
  const { data: res, error } = await admin.auth.admin.inviteUserByEmail(email, {
    data,
    redirectTo: `${await siteOrigin()}/auth/callback?next=${encodeURIComponent("/account?welcome=1")}`,
  });
  if (res?.user) return { userId: res.user.id, reused: false };
  if (error && /already|registered|exists/i.test(error.message)) {
    const userId = await findAuthUserId(admin, email);
    return userId ? { userId, reused: true } : { error: "Could not find the existing sign-in account for that email." };
  }
  // The sign-in account may have been created before sending failed; remove it so a retry starts clean.
  const orphan = await findAuthUserId(admin, email);
  if (orphan) await admin.auth.admin.deleteUser(orphan);
  const msg = error?.message ?? "Could not send the invitation.";
  if (/rate|limit|too many/i.test(msg)) return { error: "Email limit reached", rateLimited: true };
  return { error: /sending|smtp|email/i.test(msg) ? "The invitation email could not be sent (check SMTP settings)" : msg };
}

const SMTP_HELP =
  "The invitation email could not be sent, so nothing was saved. Check Supabase → Authentication → Emails → SMTP settings " +
  "(host, port, username, app password, and that the sender address matches the SMTP account), then try again — " +
  "or choose “Show me a temporary password” to add them now without email.";

export async function createStaff(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const me = await requireSuperAdmin();
  const email = str(fd, "email").toLowerCase();
  const fullName = str(fd, "full_name");
  const access = parseAccess(fd);
  if (!email || !fullName || !access) return fail("Name, email and role are required.");
  const admin = createAdminClient();
  const method = str(fd, "method");

  const { data: existingStaff } = await admin.from("staff").select("id, active").eq("email", email).maybeSingle();
  if (existingStaff) {
    return fail(
      existingStaff.active
        ? "That email already belongs to a staff member. Open them in the list above to change their access."
        : "That email belongs to a deactivated staff member. Open them in the list above and tick Active.",
    );
  }

  let userId: string | null = null;
  let password: string | null = null;
  let reusedAccount = false;

  if (method === "invite") {
    const { data: secs } = access.sections.length ? await admin.from("sections").select("name").in("id", access.sections) : { data: [] };
    const r = await inviteLogin(admin, email, inviteData(fullName, access.role, (secs ?? []).map((x) => x.name)));
    if ("error" in r) return fail(r.rateLimited ? "Supabase's hourly email limit was reached. Try again later, or raise it under Authentication → Rate Limits." : SMTP_HELP);
    userId = r.userId;
    reusedAccount = r.reused;
  } else {
    password = tempPassword();
    const r = await createLoginWithPassword(admin, email, password);
    if ("error" in r) return fail(r.error);
    userId = r.userId;
    reusedAccount = r.reused;
  }
  if (!userId) return fail("Could not find or create the sign-in account for that email.");

  const saved = await saveStaffRecord(admin, me, { userId, email, fullName, ...access });
  if (saved) return fail(saved);
  await admin.from("audit_log").insert({ actor_id: me.id, action: "staff.created", entity: "staff", entity_id: userId, detail: { email, role: access.role } });
  revalidatePath("/admin/staff");
  if (password) {
    return ok(`${fullName} added. Temporary password: ${password} — give it to them privately; they can change it under My account.`);
  }
  return ok(
    reusedAccount
      ? `${fullName} added. They already had a sign-in account, so no invitation was sent — they can use “Forgot password?” on the sign-in page, or reset their password from their staff page.`
      : `${fullName} added and an invitation email was sent.`,
  );
}

// ---------------------------------------------------------------------------
// Bulk add
// ---------------------------------------------------------------------------
export async function readStaffSheet(fd: FormData): Promise<{ cells: string[][] } | { error: string }> {
  await requireSuperAdmin();
  const file = fd.get("file");
  if (!(file instanceof File)) return { error: "No file chosen." };
  if (file.size > 3 * 1024 * 1024) return { error: "The file is larger than 3 MB." };
  const cells = await readSheetCells(await file.arrayBuffer());
  return cells ? { cells } : { error: "Could not read this Excel file. Save it as .xlsx (or CSV) and try again." };
}

export type BulkStaffResult = {
  full_name: string;
  email: string;
  status: "added" | "skipped" | "failed";
  note: string;
  password?: string;
};

/**
 * Adds many staff at once. method "password" gives each a temporary password (shown once, in the results);
 * "google" gives them an unguessable password nobody sees — they sign in with Google (or get a reset later).
 */
export async function bulkAddStaff(
  rows: Pick<StaffImportRow, "full_name" | "email" | "role" | "sections">[],
  method: "invite" | "password" | "google",
): Promise<{ results: BulkStaffResult[] } | { error: string }> {
  const me = await requireSuperAdmin();
  if (!Array.isArray(rows) || rows.length === 0) return { error: "No staff to add." };
  if (rows.length > 50) return { error: "Send at most 50 staff per request." };
  const admin = createAdminClient();
  const [{ data: sections }, { data: existing }] = await Promise.all([
    admin.from("sections").select("id, name, code").eq("school_id", me.schoolId),
    admin.from("staff").select("email"),
  ]);
  const sectionId = new Map<string, string>();
  const sectionName = new Map<string, string>();
  for (const x of sections ?? []) {
    sectionName.set(x.id, x.name);
    sectionId.set(x.name.toLowerCase(), x.id);
    sectionId.set(x.code.toLowerCase(), x.id);
  }
  const taken = new Set((existing ?? []).map((x) => x.email.toLowerCase()));
  const results: BulkStaffResult[] = [];
  let emailLimitHit = false;

  for (const raw of rows) {
    const email = String(raw.email ?? "").trim().toLowerCase();
    const fullName = String(raw.full_name ?? "").trim();
    const role: StaffRole = raw.role === "admin" ? "admin" : "teacher";
    const base = { full_name: fullName, email };
    if (!fullName || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      results.push({ ...base, status: "failed", note: "Missing name or invalid email" });
      continue;
    }
    if (taken.has(email)) {
      results.push({ ...base, status: "skipped", note: "Already on the staff list" });
      continue;
    }
    const ids = role === "admin" ? (raw.sections ?? []).map((n) => sectionId.get(String(n).trim().toLowerCase())) : [];
    if (ids.some((x) => !x)) {
      results.push({ ...base, status: "failed", note: `Unknown section "${raw.sections.join(", ")}"` });
      continue;
    }
    if (emailLimitHit) {
      results.push({ ...base, status: "failed", note: "Not sent — email limit reached. Upload the file again later; people already added are skipped." });
      continue;
    }
    const password = method === "password" ? tempPassword() : tempPassword() + tempPassword();
    const login =
      method === "invite"
        ? await inviteLogin(admin, email, inviteData(fullName, role, (ids as string[]).map((id) => sectionName.get(id) ?? "")))
        : await createLoginWithPassword(admin, email, password);
    if ("error" in login) {
      if ("rateLimited" in login && login.rateLimited) emailLimitHit = true;
      results.push({
        ...base,
        status: "failed",
        note: emailLimitHit ? "Not sent — email limit reached. Upload the file again later; people already added are skipped." : login.error,
      });
      continue;
    }
    const saved = await saveStaffRecord(admin, me, {
      userId: login.userId,
      email,
      fullName,
      role,
      sections: ids as string[],
      permissions: role === "admin" ? HOD_DEFAULT_PERMISSIONS : [],
    });
    if (saved) {
      results.push({ ...base, status: "failed", note: saved });
      continue;
    }
    taken.add(email);
    results.push({
      ...base,
      status: "added",
      note:
        (role === "admin" ? "Head of Section" : "Teacher") +
        (method === "invite" ? (login.reused ? " · already had a sign-in account, no email sent — they can use Forgot password" : " · invitation emailed") : ""),
      password: method === "password" ? password : undefined,
    });
  }
  const added = results.filter((r) => r.status === "added");
  if (added.length) {
    await admin.from("audit_log").insert({
      actor_id: me.id,
      action: "staff.bulk_created",
      entity: "staff",
      detail: { count: added.length, method, emails: added.map((r) => r.email) },
    });
  }
  revalidatePath("/admin/staff");
  return { results };
}

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------
/**
 * Permanently removes a staff member and their sign-in account. Refused for anyone whose work is part of the
 * school's records (questions or tests they wrote) — deactivate them instead, which keeps reports intact.
 */
export async function deleteStaff(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const me = await requireSuperAdmin();
  const id = str(fd, "id");
  if (!id) return fail("Missing staff member.");
  if (id === me.id) return fail("You can't delete your own account.");
  const admin = createAdminClient();
  const { data: m } = await admin.from("staff").select("id, email, full_name, role").eq("id", id).maybeSingle();
  if (!m) return fail("That staff member no longer exists.");
  if (m.role === "super_admin") {
    const { count } = await admin.from("staff").select("id", { count: "exact", head: true }).eq("role", "super_admin").eq("active", true);
    if ((count ?? 0) <= 1) return fail("This is the only super admin. Make someone else a super admin first.");
  }
  const [{ count: questions }, { count: tests }] = await Promise.all([
    admin.from("questions").select("id", { count: "exact", head: true }).eq("owner_id", id),
    admin.from("assessments").select("id", { count: "exact", head: true }).eq("created_by", id),
  ]);
  if ((questions ?? 0) + (tests ?? 0) > 0) {
    return fail(
      `${m.full_name} wrote ${questions ?? 0} question(s) and ${tests ?? 0} test(s)/exam(s), which are part of students' results, so they can't be deleted. ` +
        "Untick “Active” above and save instead — they won't be able to sign in, and their work stays in the reports.",
    );
  }
  const { error } = await admin.auth.admin.deleteUser(id);
  if (error) return fail(`Could not delete: ${error.message}`);
  await admin.from("audit_log").insert({
    actor_id: me.id,
    action: "staff.deleted",
    entity: "staff",
    entity_id: id,
    detail: { email: m.email, full_name: m.full_name, role: m.role },
  });
  revalidatePath("/admin/staff");
  redirect("/admin/staff?deleted=" + encodeURIComponent(m.full_name));
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

/** Sends a real email (a password-reset link) to the signed-in super admin to prove SMTP works. */
export async function sendTestEmail(): Promise<ActionResult> {
  const me = await requireSuperAdmin();
  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("x-forwarded-host") ?? h.get("host")}`;
  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(me.email, { redirectTo: `${origin}/auth/callback?next=/account` });
  if (error) {
    if (/seconds|rate|limit/i.test(error.message)) return fail(`Supabase is rate-limiting emails: ${error.message}`);
    return fail(
      `Email delivery failed: ${error.message}. Check Supabase → Authentication → Emails → SMTP settings, then Supabase → Logs → Auth for the exact reason.`,
    );
  }
  return ok(`Email sent to ${me.email}. If it arrives (check spam too), email delivery works. The link in it is a normal password-reset link — you can ignore it.`);
}
