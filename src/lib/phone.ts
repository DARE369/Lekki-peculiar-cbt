/** Accepts local (0803…) and international (+234 803…) numbers; returns them tidied, or null if not a phone number. */
export function normalisePhone(raw: string): string | null {
  const digits = raw.replace(/[^\d+]/g, "");
  const bare = digits.replace(/^\+/, "");
  if (!/^\d{7,15}$/.test(bare)) return null;
  return digits.startsWith("+") ? `+${bare}` : bare;
}
