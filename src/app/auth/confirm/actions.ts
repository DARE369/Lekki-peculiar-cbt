"use server";

import { createClient } from "@/lib/supabase/server";

/** Turns the tokens from an email link's URL fragment into a normal (cookie) session. */
export async function adoptSession(accessToken: string, refreshToken: string): Promise<{ ok: boolean }> {
  if (typeof accessToken !== "string" || typeof refreshToken !== "string" || !accessToken || !refreshToken) return { ok: false };
  const supabase = await createClient();
  const { error } = await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
  if (error) return { ok: false };
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { ok: !!user };
}
