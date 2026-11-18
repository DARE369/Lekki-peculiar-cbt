"use server";

import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/auth";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { fail, str, type ActionResult } from "@/lib/actions";

export async function setPassword(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const me = await requireStaff();
  const password = str(fd, "password");
  if (password.length < 8) return fail("Use at least 8 characters.");
  if (password !== str(fd, "confirm")) return fail("The two passwords don't match.");
  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) return fail(/same|different from the old/i.test(error.message) ? "That's already your password — choose a new one." : error.message);
  await createAdminClient().from("staff").update({ needs_password: false }).eq("id", me.id);
  redirect("/dashboard");
}
