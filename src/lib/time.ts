// The school runs on Lagos time (WAT, UTC+1, no daylight saving). <input type="datetime-local">
// values carry no zone, so we interpret them explicitly as Lagos time on the server.
export const SCHOOL_TZ = "Africa/Lagos";
const OFFSET = "+01:00";

/** "2026-10-05T09:30" (Lagos) → ISO string in UTC. Returns null for empty/invalid input. */
export function lagosLocalToIso(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) return null;
  const d = new Date(`${value.slice(0, 16)}:00${OFFSET}`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** ISO → "2026-10-05T09:30" in Lagos time, for datetime-local default values. */
export function isoToLagosLocal(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  const lagos = new Date(d.getTime() + 60 * 60 * 1000);
  return lagos.toISOString().slice(0, 16);
}

export function formatTime(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-NG", { hour: "numeric", minute: "2-digit", timeZone: SCHOOL_TZ }).format(new Date(iso));
}

export function minutesBetween(a: string, b: string) {
  return Math.round((Date.parse(b) - Date.parse(a)) / 60000);
}
