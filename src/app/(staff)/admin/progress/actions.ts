"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { fail, int, ok, str, type ActionResult } from "@/lib/actions";
import { inviteData } from "@/lib/invite";
import { siteOrigin } from "@/lib/site";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import type { StaffRole } from "@/lib/types";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Question deadlines. Super admins set the school-wide deadline, the questions-per-subject target and every section's
 * deadline; Heads of Section set the deadline for their own sections.
 */
export async function saveDeadlines(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const me = await requireAdmin();
  const admin = createAdminClient();
  const date = (k: string) => {
    const v = str(fd, k);
    return v && DATE.test(v) ? v : null;
  };
  if (me.isSuperAdmin) {
    const perSubject = int(fd, "questions_per_subject", 40);
    if (perSubject < 1 || perSubject > 500) return fail("Questions per subject must be between 1 and 500.");
    const { error } = await admin
      .from("schools")
      .update({ question_deadline: date("school_deadline"), questions_per_subject: perSubject })
      .eq("id", me.schoolId);
    if (error) return fail(error);
  }
  const { data: sections } = await admin.from("sections").select("id").eq("school_id", me.schoolId).eq("cbt_enabled", true);
  for (const sec of sections ?? []) {
    if (!fd.has(`section_${sec.id}`)) continue;
    if (!me.isSuperAdmin && !me.sectionIds.includes(sec.id)) continue;
    await admin.from("sections").update({ question_deadline: date(`section_${sec.id}`) }).eq("id", sec.id);
  }
  await admin.from("audit_log").insert({ actor_id: me.id, action: "deadlines.updated", entity: "school", entity_id: me.schoolId });
  revalidatePath("/", "layout");
  return ok("Deadlines saved. Teachers see them on their dashboard.");
}

/**
 * Sends the invitation email again to someone who hasn't signed in. If their account is already confirmed,
 * a "set your password" email is sent instead.
 */
export async function resendInvite(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const me = await requireAdmin();
  const admin = createAdminClient();
  const { data: person } = await admin.from("staff").select("id, email, full_name, role, school_id").eq("id", str(fd, "id")).maybeSingle();
  if (!person || person.school_id !== me.schoolId) return fail("That staff member no longer exists.");
  const { data: secs } = await admin.from("admin_sections").select("sections(name)").eq("staff_id", person.id);
  const sectionNames = ((secs ?? []) as unknown as { sections: { name: string } | null }[]).map((x) => x.sections?.name ?? "").filter(Boolean);
  // Not the shared invite helper: that one removes the account when sending fails, which here would delete the staff member.
  const { error } = await admin.auth.admin.inviteUserByEmail(person.email, {
    data: inviteData(person.full_name, person.role as StaffRole, sectionNames),
    redirectTo: `${await siteOrigin()}/auth/callback?next=${encodeURIComponent("/welcome")}`,
  });
  if (error && /already|registered|exists/i.test(error.message)) {
    const { error: e2 } = await (await createClient()).auth.resetPasswordForEmail(person.email, {
      redirectTo: `${await siteOrigin()}/auth/callback?next=${encodeURIComponent("/welcome")}`,
    });
    if (e2) return fail(`The email could not be sent: ${e2.message}`);
    return ok(`Sent ${person.full_name} a link to set their password.`);
  }
  if (error) {
    return fail(/rate|limit/i.test(error.message) ? "Supabase's hourly email limit was reached. Try again later." : `The email could not be sent: ${error.message}`);
  }
  await admin.from("audit_log").insert({ actor_id: me.id, action: "staff.invite_resent", entity: "staff", entity_id: person.id });
  return ok(`Invitation sent again to ${person.email}.`);
}
