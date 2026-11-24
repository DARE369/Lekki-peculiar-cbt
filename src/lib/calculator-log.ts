/**
 * The record of what students worked out on the exam calculator, for a teacher to review or audit.
 * Each entry is an exam event of type "calculator" sent from the student's computer. Because it comes from a
 * browser it is never trusted: every field is checked and shortened before it is shown.
 */

export interface CalcUse {
  attemptId: string;
  /** when it was worked out (the exam screen's estimate of the school server's clock) */
  at: string;
  /** the question the student was on (an id from the test); empty if unknown */
  questionId: string;
  /** the number the student saw on screen for that question (questions are shuffled per student) */
  shownAs: number | null;
  expr: string;
  result: string;
}

const clip = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");
/** What a real calculator sum and answer can look like. Anything else did not come from the calculator. */
const SUM = /^[0-9.+\-−×÷*/x()\s]+$/i;
const ANSWER = /^-?[0-9.]+(e[+-]?[0-9]+)?$/i;

/** Text for a spreadsheet cell: stops a cell that starts like a formula from being run when the file is opened. */
export function csvSafe(v: string) {
  return /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
}

export function parseCalcEvent(row: { attempt_id: string; created_at: string; detail: unknown }): CalcUse | null {
  const d = row.detail && typeof row.detail === "object" ? (row.detail as Record<string, unknown>) : null;
  if (!d) return null;
  const expr = clip(d.expr, 80);
  const result = clip(d.result, 40);
  if (!SUM.test(expr) || !ANSWER.test(result)) return null;
  const at = typeof d.at === "string" && !Number.isNaN(Date.parse(d.at)) ? d.at : row.created_at;
  const n = typeof d.n === "number" && Number.isFinite(d.n) ? Math.trunc(d.n) : null;
  return { attemptId: row.attempt_id, at, questionId: clip(d.q, 40), shownAs: n, expr, result };
}

export interface QuestionUse {
  questionId: string;
  uses: number;
  students: number;
}

/** Uses by student (in the order they happened), and by question (how many calculations, how many students). */
export function groupCalcUses(uses: CalcUse[]) {
  const byAttempt = new Map<string, CalcUse[]>();
  const byQuestion = new Map<string, { uses: number; attempts: Set<string> }>();
  for (const u of [...uses].sort((a, b) => Date.parse(a.at) - Date.parse(b.at))) {
    byAttempt.set(u.attemptId, [...(byAttempt.get(u.attemptId) ?? []), u]);
    const q = byQuestion.get(u.questionId) ?? { uses: 0, attempts: new Set<string>() };
    q.uses++;
    q.attempts.add(u.attemptId);
    byQuestion.set(u.questionId, q);
  }
  const questions: QuestionUse[] = [...byQuestion.entries()].map(([questionId, v]) => ({ questionId, uses: v.uses, students: v.attempts.size }));
  return { byAttempt, questions };
}
