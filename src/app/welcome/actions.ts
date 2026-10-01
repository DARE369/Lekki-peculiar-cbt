"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/auth";
import { fail, str, type ActionResult } from "@/lib/actions";
import { getStructure } from "@/lib/data";
import { normalisePhone } from "@/lib/phone";
import { applySubjectPicks } from "@/lib/assignments";
import { createAdminClient, createClient } from "@/lib/supabase/server";

export async function saveAbout(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const me = await requireStaff();
  const fullName = str(fd, "full_name").replace(/\s+/g, " ");
  const phone = normalisePhone(str(fd, "phone"));
  if (fullName.length < 3) return fail("Please type your full name.");
  if (!phone) return fail("Please type a phone number we can reach you on, e.g. 0803 123 4567.");
  // Staff can't edit their own row under RLS (only super admins can), so this narrow update runs server-side.
  const { error } = await createAdminClient().from("staff").update({ full_name: fullName, phone }).eq("id", me.id);
  if (error) return fail(error);
  redirect(`/welcome?step=${str(fd, "next")}`);
}

export async function savePassword(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const me = await requireStaff();
  const password = str(fd, "password");
  if (password.length < 8) return fail("Use at least 8 characters.");
  if (password !== str(fd, "confirm")) return fail("The two passwords are not the same. Please type them again.");
  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password });
  if (error && !/same|different from the old/i.test(error.message)) return fail(error.message);
  await createAdminClient().from("staff").update({ needs_password: false }).eq("id", me.id);
  redirect(`/welcome?step=${str(fd, "next")}`);
}

/** Saves the subject/class choices. Pending choices that were unticked are withdrawn; approved ones stay. */
export async function saveSubjects(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const me = await requireStaff();
  const s = await getStructure();
  const err = await applySubjectPicks(me.id, s, fd.getAll("pick").map(String));
  if (err) return fail(err);
  revalidatePath("/teach/classes");
  redirect(`/welcome?step=${str(fd, "next")}`);
}

export async function finishOnboarding(fd: FormData) {
  const me = await requireStaff();
  await createAdminClient().from("staff").update({ onboarded_at: new Date().toISOString() }).eq("id", me.id);
  revalidatePath("/", "layout");
  const to = str(fd, "to");
  redirect(to.startsWith("/") && !to.startsWith("//") ? to : "/dashboard");
}
