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

/** Supabase only sends one email per person a minute (and a few per hour overall). Say so plainly. */
function emailError(message: string) {
  const wait = message.match(/after (\d+) seconds?/);
  if (wait) return `An email was sent a moment ago. Please check your inbox (and spam folder), or try again in ${wait[1]} seconds.`;
  if (/rate|limit|too many/i.test(message)) return "Too many emails have been sent just now. Please wait a few minutes and try again.";
  return message;
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
  if (error && !/not found|signups not allowed/i.test(error.message)) return fail(emailError(error.message));
  return ok("If that email belongs to a staff account, a sign-in link is on its way. Check your inbox.");
}

export async function sendPasswordReset(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const email = str(fd, "email");
  if (!email) return fail("Enter your school email first.");
  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${await origin()}/auth/callback?next=${encodeURIComponent("/account?reset=1")}`,
  });
  if (error && /rate|limit|seconds|too many/i.test(error.message)) return fail(emailError(error.message));
  return ok("If that email belongs to a staff account, a reset link is on its way.");
}

/** Starts "Continue with Google". Only Google accounts that match an existing staff email get in (see /auth/callback). */
export async function signInWithGoogle(fd: FormData) {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${await origin()}/auth/callback?next=${encodeURIComponent(safeNext(str(fd, "next")))}`,
      // Show the account chooser, preferring school accounts. The real check is the staff list.
      queryParams: { prompt: "select_account", ...(process.env.GOOGLE_HOSTED_DOMAIN ? { hd: process.env.GOOGLE_HOSTED_DOMAIN } : {}) },
    },
  });
  if (error || !data.url) redirect("/login?error=google");
  redirect(data.url);
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
