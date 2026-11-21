"use server";

import { revalidatePath } from "next/cache";
import { can, requireAdmin } from "@/lib/auth";
import { bool, fail, ok, str, type ActionResult } from "@/lib/actions";
import { createAdminClient } from "@/lib/supabase/server";

/** Turns automatic approval of clash-free teaching requests on or off for one section. */
export async function setAutoApprove(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const me = await requireAdmin();
  const sectionId = str(fd, "section_id");
  if (!can(me, "teachers.manage")) return fail("You need the permission to approve teaching assignments.");
  if (!me.isSuperAdmin && !me.sectionIds.includes(sectionId)) return fail("You can only change your own section.");
  const on = bool(fd, "auto_approve");
  const admin = createAdminClient();
  const { error } = await admin.from("sections").update({ auto_approve_requests: on }).eq("id", sectionId).eq("school_id", me.schoolId);
  if (error) {
    if (/auto_approve_requests/.test(error.message)) return fail("This setting needs a database update first. Ask whoever looks after the system to run the latest migration.");
    return fail(error, "settings.auto_approve");
  }
  await admin.from("audit_log").insert({ actor_id: me.id, action: on ? "settings.auto_approve_on" : "settings.auto_approve_off", entity: "section", entity_id: sectionId });
  revalidatePath("/admin/settings", "layout");
  revalidatePath("/admin/assignments");
  return ok(on ? "Saved. Requests without a clash will be approved straight away." : "Saved. Every request will now wait for you.");
}
