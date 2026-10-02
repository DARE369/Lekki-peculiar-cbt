// Is a submitted test sound, and could students actually sit it? Pure functions, so the rules are easy to test
// and the same checks serve the bulk review screen, the single review page and the dashboards.
import type { AssessmentSettings, QuestionOption } from "@/lib/types";

export type Severity = "block" | "warn";
export interface Issue {
  code: string;
  severity: Severity;
  message: string;
}
export type Verdict = "ready" | "warnings" | "blocked";

export interface QuestionFacts {
  id: string;
  body: string;
  options: QuestionOption[];
  answer: string;
  topic: string | null;
}

export interface ContentFacts {
  type: string;
  /** Questions each student receives. */
  questionCount: number;
  durationMinutes: number;
  settings: Pick<AssessmentSettings, "show_result">;
  /** Everything in the pool. */
  questions: QuestionFacts[];
  /** Share (0–100) of this test's questions that also appear in other tests for the same subject and year. */
  overlapPercent: number;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Problems with the questions themselves. "block" ones stop approval; "warn" ones are for the reviewer to weigh. */
export function checkContent(f: ContentFacts): { verdict: Verdict; issues: Issue[] } {
  const issues: Issue[] = [];
  const add = (code: string, severity: Severity, message: string) => issues.push({ code, severity, message });
  const pool = f.questions.length;

  if (pool < f.questionCount) add("too_few", "block", `Only ${pool} question${pool === 1 ? "" : "s"}, but the test needs ${f.questionCount}.`);

  const noAnswer = f.questions.filter((q) => !q.options.some((o) => o.key === q.answer));
  if (noAnswer.length) add("no_answer", "block", `${noAnswer.length} question${noAnswer.length === 1 ? " has" : "s have"} no valid correct answer.`);
  const empty = f.questions.filter((q) => !q.body.trim() || q.options.length < 2 || q.options.some((o) => !o.text.trim()));
  if (empty.length) add("incomplete", "block", `${empty.length} question${empty.length === 1 ? " is" : "s are"} missing text or options.`);

  const seen = new Map<string, number>();
  for (const q of f.questions) seen.set(norm(q.body), (seen.get(norm(q.body)) ?? 0) + 1);
  const dupes = [...seen.values()].filter((n) => n > 1).length;
  if (dupes) add("duplicates", "warn", `${dupes} question${dupes === 1 ? " appears" : "s appear"} more than once.`);

  const sameOption = f.questions.filter((q) => new Set(q.options.map((o) => norm(o.text))).size < q.options.length).length;
  if (sameOption) add("same_options", "warn", `${sameOption} question${sameOption === 1 ? " has" : "s have"} two identical options.`);

  if (pool >= 8) {
    const counts = new Map<string, number>();
    for (const q of f.questions) counts.set(q.answer, (counts.get(q.answer) ?? 0) + 1);
    const [letter, n] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0] ?? ["", 0];
    if (n / pool > 0.6) add("skewed_key", "warn", `${Math.round((n / pool) * 100)}% of the answers are "${letter}". Students may guess the pattern.`);
  }

  const secondsEach = (f.durationMinutes * 60) / Math.max(1, f.questionCount);
  if (secondsEach < 30) add("rushed", "warn", `Only ${Math.round(secondsEach)} seconds per question.`);
  else if (secondsEach > 180) add("slow", "warn", `${Math.round(secondsEach / 60)} minutes per question is a lot of time.`);

  if (pool > 0 && pool === f.questionCount) add("same_paper", "warn", "Every student gets exactly the same questions (the pool is no bigger than the test).");
  if (pool > 0 && f.questions.every((q) => !q.topic)) add("no_topics", "warn", "No questions have a topic, so topic analysis in reports will be empty.");
  if (f.overlapPercent > 50) add("overlap", "warn", `${Math.round(f.overlapPercent)}% of these questions are also used in another test for this year group.`);
  if ((f.type === "exam" || f.type === "mock") && f.settings.show_result === "full") {
    add("shows_answers", "warn", "Students will see the correct answers straight after the exam.");
  }

  const verdict: Verdict = issues.some((i) => i.severity === "block") ? "blocked" : issues.length ? "warnings" : "ready";
  return { verdict, issues };
}

export interface ClassFacts {
  id: string;
  name: string;
  students: number;
  studentsWithoutPhoto: number;
  /** Date (Lagos, yyyy-mm-dd) of this test's window for the class, if scheduled. */
  scheduledDay: string | null;
  /** Other exam windows for the class on the same day. */
  otherWindowsThatDay: number;
}

export interface ClassReadiness {
  classId: string;
  name: string;
  ready: boolean;
  notes: string[];
}

/** Could each class arm actually sit it? Advisory only: nothing here blocks approval. */
export function checkLive(classes: ClassFacts[], teacherApprovedFor: Set<string>): ClassReadiness[] {
  return classes.map((c) => {
    const notes: string[] = [];
    if (c.students === 0) notes.push("No students in this class yet");
    if (c.studentsWithoutPhoto > 0 && c.students > 0) notes.push(`${c.studentsWithoutPhoto} of ${c.students} students have no photo`);
    if (!teacherApprovedFor.has(c.id)) notes.push("The teacher isn't approved for this class");
    if (c.scheduledDay && c.otherWindowsThatDay >= 2) notes.push(`${c.otherWindowsThatDay + 1} exams that day`);
    if (!c.scheduledDay) notes.push("No date set yet");
    // "No date set yet" is normal before scheduling, so it doesn't make a class "not ready" on its own.
    const blocking = notes.filter((n) => n !== "No date set yet");
    return { classId: c.id, name: c.name, ready: blocking.length === 0, notes };
  });
}

/** Overlap between this test's questions and those used by other tests (ids only). */
export function overlapPercent(ids: string[], others: Set<string>): number {
  if (ids.length === 0) return 0;
  return (ids.filter((id) => others.has(id)).length / ids.length) * 100;
}

export const FLAG_CATEGORIES: { value: string; label: string }[] = [
  { value: "wrong_answers", label: "Wrong answers" },
  { value: "duplicates", label: "Duplicate or repeated questions" },
  { value: "difficulty", label: "Too hard or too easy" },
  { value: "typos", label: "Typing or formatting mistakes" },
  { value: "topic", label: "Wrong topic or year group" },
  { value: "other", label: "Something else" },
];
export const flagLabel = (v: string | null | undefined) => FLAG_CATEGORIES.find((c) => c.value === v)?.label ?? "Needs a second look";
