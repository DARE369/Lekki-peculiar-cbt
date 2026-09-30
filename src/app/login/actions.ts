"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { fail, ok, str, type ActionResult } from "@/lib/actions";

function safeNext(next: string) {
  return next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";
}

async function origin() {
  const h = await headers();
  const proto = h.get("x-forwarded-proto") ?? "https";
  return `${proto}://${h.get("x-forwarded-host") ?? h.get("host")}`;
}

export async function signInWithPassword(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email: str(fd, "email"), password: str(fd, "password") });
  if (error) return fail("Email or password is incorrect.");
  redirect(safeNext(str(fd, "next")));
}

export async function sendMagicLink(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const email = str(fd, "email");
  if (!email) return fail("Enter your school email first.");
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      shouldCreateUser: false,
      emailRedirectTo: `${await origin()}/auth/callback?next=${encodeURIComponent(safeNext(str(fd, "next")))}`,
    },
  });
  // Don't reveal whether the email exists.
  if (error && !/not found|signups not allowed/i.test(error.message)) return fail(error.message);
  return ok("If that email belongs to a staff account, a sign-in link is on its way. Check your inbox.");
}

export async function sendPasswordReset(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const email = str(fd, "email");
  if (!email) return fail("Enter your school email first.");
  const supabase = await createClient();
  await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${await origin()}/auth/callback?next=/account` });
  return ok("If that email belongs to a staff account, a reset link is on its way.");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
