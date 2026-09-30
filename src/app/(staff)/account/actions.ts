"use server";

import { createClient } from "@/lib/supabase/server";
import { fail, ok, str, type ActionResult } from "@/lib/actions";

export async function changePassword(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const password = str(fd, "password");
  if (password.length < 10) return fail("Use at least 10 characters.");
  if (password !== str(fd, "confirm")) return fail("The two passwords don't match.");
  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) return fail(error.message);
  return ok("Password updated.");
}
