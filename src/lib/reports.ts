// Pure report calculations (no I/O) so they can be unit tested.

export interface AttemptRow {
  id: string;
  student_id: string;
  class_id: string | null;
  assessment_id: string;
  status: string;
  score: number | null;
  max_score: number | null;
  correct_count: number | null;
  answered_count: number | null;
  total_questions: number;
  started_at: string;
  submitted_at: string | null;
  is_makeup: boolean;
  focus_losses: number;
  relogins: number;
  late_sync: boolean;
  login_method: string;
  question_order: { q: string; o: string[] }[];
}

export function percent(a: Pick<AttemptRow, "score" | "max_score">): number | null {
  if (a.score == null || !a.max_score) return null;
  return Math.round((Number(a.score) / Number(a.max_score)) * 1000) / 10;
}

export interface Summary {
  count: number;
  mean: number | null;
  median: number | null;
  high: number | null;
  low: number | null;
  passRate: number | null;
}

export function summarize(values: number[], passMark: number): Summary {
  if (values.length === 0) return { count: 0, mean: null, median: null, high: null, low: null, passRate: null };
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const round = (n: number) => Math.round(n * 10) / 10;
  return {
    count: values.length,
    mean: round(values.reduce((a, b) => a + b, 0) / values.length),
    median: round(sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2),
    high: sorted[sorted.length - 1],
    low: sorted[0],
    passRate: round((values.filter((v) => v >= passMark).length / values.length) * 100),
  };
}

/** Ten-point buckets: 0–9, 10–19 … 90–100. */
export function distribution(values: number[]): { label: string; count: number }[] {
  const buckets = Array.from({ length: 10 }, (_, i) => ({ label: i === 9 ? "90–100" : `${i * 10}–${i * 10 + 9}`, count: 0 }));
  for (const v of values) buckets[Math.min(9, Math.floor(v / 10))].count += 1;
  return buckets;
}

/** Standard competition ranking (1, 2, 2, 4) — how Nigerian schools usually report positions. */
export function positions<T>(rows: T[], value: (r: T) => number | null): Map<T, number> {
  const scored = rows.filter((r) => value(r) != null).sort((a, b) => value(b)! - value(a)!);
  const out = new Map<T, number>();
  scored.forEach((r, i) => {
    const prev = scored[i - 1];
    out.set(r, prev && value(prev) === value(r) ? out.get(prev)! : i + 1);
  });
  return out;
}

export function ordinal(n: number) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

export interface PaperQuestion {
  id: string;
  body: string;
  options: { key: string; text: string }[];
  answer: string;
  topic: string | null;
}

export interface ItemStat {
  question: PaperQuestion;
  number: number;
  seen: number;
  correct: number;
  unanswered: number;
  optionCounts: Record<string, number>;
  /** share of students who saw it and got it right, 0–100 */
  pctCorrect: number | null;
  /** most-chosen wrong option, if it beats the right answer or draws ≥ 30% — often a wrong key or misconception */
  topDistractor: { key: string; count: number } | null;
  suspicious: boolean;
}

export function itemAnalysis(
  questions: PaperQuestion[],
  attempts: Pick<AttemptRow, "id" | "question_order">[],
  answers: { attempt_id: string; question_id: string; selected: string | null }[],
): ItemStat[] {
  const byAttempt = new Map<string, Map<string, string | null>>();
  for (const a of answers) {
    if (!byAttempt.has(a.attempt_id)) byAttempt.set(a.attempt_id, new Map());
    byAttempt.get(a.attempt_id)!.set(a.question_id, a.selected);
  }
  return questions.map((q, i) => {
    const counts: Record<string, number> = Object.fromEntries(q.options.map((o) => [o.key, 0]));
    let seen = 0;
    let unanswered = 0;
    for (const t of attempts) {
      if (!t.question_order.some((o) => o.q === q.id)) continue;
      seen += 1;
      const sel = byAttempt.get(t.id)?.get(q.id) ?? null;
      if (!sel) unanswered += 1;
      else counts[sel] = (counts[sel] ?? 0) + 1;
    }
    const correct = counts[q.answer] ?? 0;
    const wrong = Object.entries(counts)
      .filter(([k]) => k !== q.answer)
      .sort((a, b) => b[1] - a[1])[0];
    const topDistractor = wrong && wrong[1] > 0 ? { key: wrong[0], count: wrong[1] } : null;
    const suspicious = Boolean(topDistractor && seen >= 5 && (topDistractor.count > correct || topDistractor.count / seen >= 0.3));
    return {
      question: q,
      number: i + 1,
      seen,
      correct,
      unanswered,
      optionCounts: counts,
      pctCorrect: seen ? Math.round((correct / seen) * 1000) / 10 : null,
      topDistractor,
      suspicious,
    };
  });
}

export function integrityFlags(a: Pick<AttemptRow, "focus_losses" | "relogins" | "late_sync" | "login_method" | "is_makeup">) {
  const flags: { label: string; tone: "warning" | "danger" | "info" | "neutral" }[] = [];
  if (a.relogins > 0) flags.push({ label: `Re-login ×${a.relogins}`, tone: "danger" });
  if (a.focus_losses > 0) flags.push({ label: `Left screen ×${a.focus_losses}`, tone: a.focus_losses > 2 ? "danger" : "warning" });
  if (a.late_sync) flags.push({ label: "Late upload", tone: "warning" });
  if (a.login_method === "name_search") flags.push({ label: "Name login", tone: "neutral" });
  if (a.is_makeup) flags.push({ label: "Make-up", tone: "info" });
  return flags;
}

export function toCsv(rows: (string | number | null | undefined)[][]) {
  return rows
    .map((r) =>
      r
        .map((v) => {
          const s = v == null ? "" : String(v);
          return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        })
        .join(","),
    )
    .join("\r\n");
}

export interface BroadsheetInput {
  student_id: string;
  score: number | null;
  max_score: number | null;
  assessment: { id: string; title: string; subject_id: string };
}

export interface Broadsheet {
  columns: { key: string; label: string; classAverage: number | null }[];
  rows: { studentId: string; cells: Record<string, number | null>; average: number | null; position: number | null }[];
}

/**
 * Students × columns. Columns are subjects (cell = the student's average % across that subject's
 * tests) or, when a subject is chosen, its individual tests.
 */
export function buildBroadsheet(
  attempts: BroadsheetInput[],
  studentIds: string[],
  by: "subject" | "assessment",
  labelFor: (key: string) => string,
): Broadsheet {
  const key = (a: BroadsheetInput) => (by === "subject" ? a.assessment.subject_id : a.assessment.id);
  const colKeys = [...new Set(attempts.map(key))];
  const cellValues = new Map<string, number[]>();
  for (const a of attempts) {
    const p = percent(a);
    if (p == null) continue;
    const k = `${a.student_id}|${key(a)}`;
    cellValues.set(k, [...(cellValues.get(k) ?? []), p]);
  }
  const avg = (xs: number[]) => (xs.length ? Math.round((xs.reduce((s, x) => s + x, 0) / xs.length) * 10) / 10 : null);
  const rows = studentIds.map((sid) => {
    const cells: Record<string, number | null> = {};
    for (const c of colKeys) cells[c] = avg(cellValues.get(`${sid}|${c}`) ?? []);
    const present = Object.values(cells).filter((v): v is number => v != null);
    return { studentId: sid, cells, average: avg(present), position: null as number | null };
  });
  const ranks = positions(rows, (r) => r.average);
  for (const r of rows) r.position = ranks.get(r) ?? null;
  const columns = colKeys
    .map((c) => ({
      key: c,
      label: labelFor(c),
      classAverage: avg(rows.map((r) => r.cells[c]).filter((v): v is number => v != null)),
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
  return { columns, rows };
}
