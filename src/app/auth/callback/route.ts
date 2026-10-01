import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createAdminClient, createClient } from "@/lib/supabase/server";

// Completes Google sign-in, email-link sign-in, invitations and password resets.
export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const rawNext = url.searchParams.get("next") ?? "/dashboard";
  const next = rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/dashboard";
  const to = (path: string) => NextResponse.redirect(new URL(path, url.origin));

  // Google (or Supabase) sent the person back with an error, e.g. sign-ups are switched off
  // and this Google account isn't a staff account.
  const oauthError = url.searchParams.get("error_description") ?? url.searchParams.get("error");
  if (oauthError) return to(/sign ?ups? not allowed|signup/i.test(oauthError) ? "/login?error=not-staff" : "/login?error=google");

  const supabase = await createClient();
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;

  let error: unknown = null;
  if (code) {
    ({ error } = await supabase.auth.exchangeCodeForSession(code));
  } else if (tokenHash && type) {
    ({ error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type }));
  } else {
    // Supabase's default email links (invites, magic links, resets) put the session in the URL fragment
    // (#access_token=…), which never reaches the server. The browser keeps the fragment across this
    // redirect, and /auth/confirm finishes sign-in from there.
    return to(`/auth/confirm?next=${encodeURIComponent(next)}`);
  }
  if (error) return to("/login?error=link");

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const viaGoogle = user?.app_metadata?.provider === "google" || user?.identities?.some((i) => i.provider === "google");
  if (user && viaGoogle) {
    const admin = createAdminClient();
    const { data: staff } = await admin.from("staff").select("id, active").eq("id", user.id).maybeSingle();
    if (!staff?.active) {
      await supabase.auth.signOut();
      // A Google account that isn't on the staff list: remove the account Supabase just made for it,
      // so only people the school added ever have accounts.
      const onlyGoogle = (user.identities ?? []).every((i) => i.provider === "google");
      if (!staff && onlyGoogle) await admin.auth.admin.deleteUser(user.id);
      return to(staff ? "/login?error=inactive" : "/login?error=not-staff");
    }
  }
  return to(next);
}
