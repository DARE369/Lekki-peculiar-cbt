import { logError } from "@/lib/errors";

export type ActionResult = { ok: true; message?: string; data?: Record<string, number> } | { ok: false; error: string } | null;

export function ok(message?: string, data?: Record<string, number>): ActionResult {
  return { ok: true, message, data };
}
/**
 * A failed action. Strings are messages written for staff and shown as they are. Anything else is an
 * unexpected error: rules the database explains itself (our own checks) are shown as written; everything
 * else is recorded in the error log and the person sees a plain message with a reference code.
 * `area` names what they were doing, e.g. "assessment.submit".
 */
export function fail(error: unknown, area = "action"): ActionResult {
  if (typeof error === "string") return { ok: false, error };
  const e = (error && typeof error === "object" ? error : {}) as { message?: unknown; code?: unknown };
  const msg = typeof e.message === "string" ? e.message : "";
  const code = typeof e.code === "string" ? e.code : "";
  // Our own SQL checks (public._require) raise readable sentences with code 42501.
  if (code === "42501" && msg && !msg.includes("row-level security")) return { ok: false, error: sentence(msg) };
  if (msg.includes("duplicate key")) return { ok: false, error: "That already exists." };
  let shown = "Something went wrong and nothing was changed. Please try again.";
  if (msg.includes("row-level security")) shown = "You don't have permission to do that.";
  else if (code === "23503") shown = "That can't be changed because other records still use it.";
  else if (code === "23514" || code === "22P02") shown = "Some of what was entered isn't valid. Check it and try again.";
  const ref = logError({ area, error, shown });
  return { ok: false, error: `${shown} (Reference ${ref})` };
}

function sentence(msg: string) {
  const t = msg.trim();
  return /[.!?]$/.test(t) ? t.charAt(0).toUpperCase() + t.slice(1) : `${t.charAt(0).toUpperCase()}${t.slice(1)}.`;
}

export function str(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === "string" ? v.trim() : "";
}
export function bool(fd: FormData, key: string): boolean {
  const v = fd.get(key);
  return v === "on" || v === "true" || v === "1";
}
export function int(fd: FormData, key: string, fallback = 0): number {
  const n = Number.parseInt(str(fd, key), 10);
  return Number.isFinite(n) ? n : fallback;
}
