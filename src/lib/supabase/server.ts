import "server-only";
import { createServerClient } from "@supabase/ssr";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { env } from "@/lib/env";

/** Supabase client acting as the signed-in staff member. Every query is checked by RLS. */
export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient(env.supabaseUrl, env.supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) cookieStore.set(name, value, options);
        } catch {
          // Called from a Server Component: cookies are read-only there. The proxy refreshes sessions.
        }
      },
    },
  });
}

/**
 * Service-role client. Bypasses RLS — only for code paths that do their own authorisation:
 * the student exam API (terminal + attempt tokens), staff account creation and file uploads.
 */
export function createAdminClient() {
  return createSupabaseClient(env.supabaseUrl, env.supabaseServiceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
