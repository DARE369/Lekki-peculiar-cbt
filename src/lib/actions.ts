export type ActionResult = { ok: true; message?: string } | { ok: false; error: string } | null;

export function ok(message?: string): ActionResult {
  return { ok: true, message };
}
export function fail(error: unknown): ActionResult {
  if (typeof error === "string") return { ok: false, error };
  if (error && typeof error === "object" && "message" in error) {
    return { ok: false, error: friendlyDbError(String((error as { message: string }).message)) };
  }
  return { ok: false, error: "Something went wrong. Please try again." };
}

function friendlyDbError(msg: string) {
  if (msg.includes("row-level security")) return "You don't have permission to do that.";
  if (msg.includes("duplicate key")) return "That already exists.";
  return msg;
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
