import "server-only";
import { createAdminClient } from "@/lib/supabase/server";

export const PHOTO_BUCKET = "student-photos";

/**
 * Signed URLs for student photos. Callers must only pass paths of students they have already
 * loaded through RLS (i.e. students this user is allowed to see).
 */
export async function signPhotos(paths: (string | null | undefined)[], expiresIn = 3600): Promise<Map<string, string>> {
  const unique = [...new Set(paths.filter((p): p is string => Boolean(p)))];
  const out = new Map<string, string>();
  if (unique.length === 0) return out;
  const { data } = await createAdminClient().storage.from(PHOTO_BUCKET).createSignedUrls(unique, expiresIn);
  for (const row of data ?? []) {
    if (row.path && row.signedUrl) out.set(row.path, row.signedUrl);
  }
  return out;
}
