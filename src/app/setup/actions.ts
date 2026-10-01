"use server";

import { redirect } from "next/navigation";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import { fail, str, type ActionResult } from "@/lib/actions";

export async function setupSuperAdmin(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const secret = env.setupSecret;
  if (!secret) return fail("SETUP_SECRET is not set on the server.");
  if (str(fd, "secret") !== secret) return fail("Setup code is incorrect.");

  const admin = createAdminClient();
  const { count } = await admin.from("staff").select("id", { count: "exact", head: true });
  if ((count ?? 0) > 0) return fail("Setup has already been completed.");

  const email = str(fd, "email").toLowerCase();
  const password = str(fd, "password");
  const fullName = str(fd, "full_name");
  if (!email || !fullName) return fail("Name and email are required.");
  if (password.length < 10) return fail("Use a password of at least 10 characters.");

  const { data: school } = await admin.from("schools").select("id").limit(1).single();
  if (!school) return fail("No school row found — were the database migrations applied?");

  const { data: created, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !created.user) return fail(error?.message ?? "Could not create the account.");

  const { error: staffError } = await admin
    .from("staff")
    .insert({ id: created.user.id, school_id: school.id, email, full_name: fullName, role: "super_admin", onboarded_at: new Date().toISOString(), needs_password: false });
  if (staffError) return fail(staffError);
  await admin.from("audit_log").insert({ actor_id: created.user.id, action: "setup.super_admin", entity: "staff", entity_id: created.user.id });

  const supabase = await createClient();
  await supabase.auth.signInWithPassword({ email, password });
  redirect("/dashboard");
}
