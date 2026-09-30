import "server-only";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { PHOTO_BUCKET } from "@/lib/photos";
import { sha256, verify, type AttemptClaims, type StudentClaims } from "./tokens";

export interface Terminal {
  id: string;
  school_id: string;
  name: string;
}

export function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { "cache-control": "no-store" } });
}
export function error(code: string, message: string, status = 400) {
  return json({ error: code, message }, status);
}

/** Every exam API call must come from a registered, active lab computer. */
export async function requireTerminal(req: Request): Promise<Terminal | null> {
  const token = req.headers.get("x-terminal-token");
  if (!token || token.length < 20) return null;
  const db = createAdminClient();
  const { data } = await db
    .from("lab_terminals")
    .select("id, school_id, name, active, last_seen_at")
    .eq("token_hash", sha256(token))
    .maybeSingle();
  if (!data || !data.active) return null;
  if (!data.last_seen_at || Date.now() - Date.parse(data.last_seen_at) > 60_000) {
    await db.from("lab_terminals").update({ last_seen_at: new Date().toISOString() }).eq("id", data.id);
  }
  return { id: data.id, school_id: data.school_id, name: data.name };
}

function bearer(req: Request) {
  const h = req.headers.get("authorization");
  return h?.startsWith("Bearer ") ? h.slice(7) : null;
}

export async function studentFrom(req: Request, terminal: Terminal) {
  const c = await verify<StudentClaims>(bearer(req), "student");
  return c && c.tid === terminal.id ? c : null;
}

export async function attemptFrom(req: Request, terminal: Terminal) {
  const c = await verify<AttemptClaims>(bearer(req), "attempt");
  // The attempt stays bound to the terminal it was started/unlocked on.
  return c && c.tid === terminal.id ? c : null;
}

export interface StudentCard {
  id: string;
  name: string;
  first_name: string;
  class_name: string;
  photo_url: string | null;
}

/** Public-facing student info for the "Is this you?" screen. No admission numbers are returned. */
export async function studentCards(ids: string[]): Promise<StudentCard[]> {
  if (ids.length === 0) return [];
  const db = createAdminClient();
  const { data } = await db
    .from("students")
    .select("id, first_name, last_name, other_names, photo_path, classes(name)")
    .in("id", ids)
    .eq("active", true);
  const rows = data ?? [];
  const paths = rows.map((r) => r.photo_path).filter(Boolean) as string[];
  const signed = new Map<string, string>();
  if (paths.length) {
    const { data: urls } = await db.storage.from(PHOTO_BUCKET).createSignedUrls(paths, 900);
    for (const u of urls ?? []) if (u.path && u.signedUrl) signed.set(u.path, u.signedUrl);
  }
  const byId = new Map(
    rows.map((r) => [
      r.id,
      {
        id: r.id,
        name: [r.first_name, r.other_names, r.last_name].filter(Boolean).join(" "),
        first_name: r.first_name,
        class_name: (r.classes as unknown as { name: string } | null)?.name ?? "",
        photo_url: r.photo_path ? (signed.get(r.photo_path) ?? null) : null,
      },
    ]),
  );
  return ids.map((id) => byId.get(id)).filter((x): x is StudentCard => Boolean(x));
}

export async function readJson<T>(req: Request): Promise<T | null> {
  try {
    return (await req.json()) as T;
  } catch {
    return null;
  }
}
