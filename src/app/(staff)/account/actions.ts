"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/auth";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { fail, ok, str, type ActionResult } from "@/lib/actions";
import { normalisePhone } from "@/lib/phone";

export async function changePassword(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const me = await requireStaff();
  const password = str(fd, "password");
  if (password.length < 8) return fail("Use at least 8 characters.");
  if (password !== str(fd, "confirm")) return fail("The two passwords don't match.");
  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) return fail(/same|different from the old/i.test(error.message) ? "That's already your password — choose a new one." : error.message);
  await createAdminClient().from("staff").update({ needs_password: false }).eq("id", me.id);
  return ok("Password updated.");
}

export async function updatePhone(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const me = await requireStaff();
  const phone = normalisePhone(str(fd, "phone"));
  if (!phone) return fail("Type a phone number, e.g. 0803 123 4567.");
  // Staff can't update their own row under RLS, so this narrow update runs server-side.
  const { error } = await createAdminClient().from("staff").update({ phone }).eq("id", me.id);
  if (error) return fail(error);
  revalidatePath("/account");
  return ok("Phone number saved.");
}
