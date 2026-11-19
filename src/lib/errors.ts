import "server-only";
import { randomInt } from "node:crypto";
import { after } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";

// No 0/O/1/I so a code read over the phone can't be mistaken.
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function newRef(length = 6) {
  let s = "";
  for (let i = 0; i < length; i++) s += ALPHABET[randomInt(ALPHABET.length)];
  return s;
}

export interface LoggedError {
  area: string;
  error: unknown;
  shown?: string;
  staffId?: string | null;
  detail?: Record<string, unknown>;
}

function describe(error: unknown): { message: string; code: string | null; extra: Record<string, unknown> } {
  if (error && typeof error === "object") {
    const e = error as { message?: unknown; code?: unknown; details?: unknown; hint?: unknown };
    return {
      message: String(e.message ?? JSON.stringify(error)).slice(0, 2000),
      code: e.code != null ? String(e.code) : null,
      extra: { details: e.details ?? null, hint: e.hint ?? null },
    };
  }
  return { message: String(error).slice(0, 2000), code: null, extra: {} };
}

/**
 * Records an unexpected failure and returns its reference code. The write happens after the response
 * is sent (so it never slows the person down) and never throws.
 */
export function logError({ area, error, shown, staffId, detail }: LoggedError): string {
  const ref = newRef();
  const d = describe(error);
  console.error(`[${area} ${ref}]`, d.message, detail ? JSON.stringify(detail) : "");
  const write = async () => {
    try {
      let who = staffId ?? null;
      if (staffId === undefined) {
        try {
          const { getStaff } = await import("@/lib/auth");
          who = (await getStaff())?.id ?? null;
        } catch {
          who = null;
        }
      }
      await createAdminClient()
        .from("app_errors")
        .insert({ ref, staff_id: who, area: area.slice(0, 80), shown: shown ?? null, message: d.message, code: d.code, detail: { ...d.extra, ...(detail ?? {}) } });
    } catch (e) {
      console.error(`[app_errors] could not record ${ref}`, e);
    }
  };
  try {
    after(write);
  } catch {
    // Outside a request (tests, scripts): write straight away.
    void write();
  }
  return ref;
}
