import "server-only";
import { env } from "@/lib/env";

/** Whether the Google provider is switched on in Supabase (Authentication → Sign In / Providers). */
export async function googleSignInEnabled(): Promise<boolean> {
  try {
    const res = await fetch(`${env.supabaseUrl}/auth/v1/settings`, {
      headers: { apikey: env.supabaseAnonKey },
      next: { revalidate: 300 },
    });
    if (!res.ok) return false;
    const s = (await res.json()) as { external?: { google?: boolean } };
    return s.external?.google === true;
  } catch {
    return false;
  }
}
