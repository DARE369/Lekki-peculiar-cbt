// Banks are named sets of questions (every upload is one; teachers can also make them by hand).

/** The default name for a bank or an unnamed group: Subject · Round · date. Teachers can rename it. */
export function defaultBankName(subject: string, round: string | null | undefined, when: Date | string) {
  const d = typeof when === "string" ? new Date(when) : when;
  const date = d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Lagos" });
  return [subject, round || "Any round", date].join(" · ").slice(0, 80);
}

export interface EarlierGroup {
  /** first and last created_at in the group (ISO) — also used as its address */
  from: string;
  to: string;
  ids: string[];
  roundId: string | null;
}

/**
 * Questions added before banks existed, split back into the uploads they came from: one upload saved all its
 * questions within moments, so a gap of more than two minutes starts a new group.
 */
export function groupByUpload(rows: { id: string; created_at: string; round_id: string | null }[], gapMs = 2 * 60_000): EarlierGroup[] {
  const sorted = [...rows].sort((a, b) => a.created_at.localeCompare(b.created_at));
  const groups: EarlierGroup[] = [];
  let cur: (EarlierGroup & { rounds: Set<string | null> }) | null = null;
  let last = 0;
  for (const r of sorted) {
    const t = Date.parse(r.created_at);
    if (!cur || t - last > gapMs) {
      if (cur) groups.push({ from: cur.from, to: cur.to, ids: cur.ids, roundId: cur.rounds.size === 1 ? [...cur.rounds][0] : null });
      cur = { from: r.created_at, to: r.created_at, ids: [], roundId: null, rounds: new Set() };
    }
    cur.ids.push(r.id);
    cur.to = r.created_at;
    cur.rounds.add(r.round_id);
    last = t;
  }
  if (cur) groups.push({ from: cur.from, to: cur.to, ids: cur.ids, roundId: cur.rounds.size === 1 ? [...cur.rounds][0] : null });
  return groups.reverse(); // newest first
}
