import { describe, expect, it } from "vitest";
import { checkContent, checkLive, overlapPercent, type QuestionFacts } from "@/lib/readiness";

const q = (n: number, over: Partial<QuestionFacts> = {}): QuestionFacts => ({
  id: `q${n}`,
  body: `Question ${n}?`,
  options: [
    { key: "A", text: `a${n}` },
    { key: "B", text: `b${n}` },
    { key: "C", text: `c${n}` },
  ],
  answer: ["A", "B", "C"][n % 3],
  topic: "Topic",
  ...over,
});
const many = (n: number) => Array.from({ length: n }, (_, i) => q(i));
const base = { type: "test", questionCount: 10, durationMinutes: 30, settings: { show_result: "score" as const }, overlapPercent: 0 };

describe("checkContent", () => {
  it("passes a sound test", () => {
    const r = checkContent({ ...base, questions: many(15) });
    expect(r).toEqual({ verdict: "ready", issues: [] });
  });

  it("blocks a test with too few questions", () => {
    const r = checkContent({ ...base, questions: many(6) });
    expect(r.verdict).toBe("blocked");
    expect(r.issues.find((i) => i.code === "too_few")?.message).toMatch(/Only 6 questions.*needs 10/);
  });

  it("blocks questions with no valid answer or missing options", () => {
    const r = checkContent({ ...base, questions: [...many(14), q(99, { answer: "D" }), q(98, { options: [{ key: "A", text: "x" }] })] });
    expect(r.issues.map((i) => i.code)).toEqual(expect.arrayContaining(["no_answer", "incomplete"]));
    expect(r.verdict).toBe("blocked");
  });

  it("warns, but doesn't block, for duplicates, a lopsided key and little time", () => {
    const qs = many(15).map((x, i) => (i < 3 ? { ...x, body: "Same question" } : { ...x, answer: "B" }));
    const r = checkContent({ ...base, durationMinutes: 4, questions: qs });
    expect(r.verdict).toBe("warnings");
    expect(r.issues.map((i) => i.code)).toEqual(expect.arrayContaining(["duplicates", "skewed_key", "rushed"]));
  });

  it("warns when every student gets the same paper, topics are missing, or answers are shown after an exam", () => {
    const r = checkContent({ ...base, type: "exam", settings: { show_result: "full" }, questions: many(10).map((x) => ({ ...x, topic: null })) });
    expect(r.issues.map((i) => i.code)).toEqual(expect.arrayContaining(["same_paper", "no_topics", "shows_answers"]));
    // The same settings on a plain test are fine.
    expect(checkContent({ ...base, type: "test", settings: { show_result: "full" }, questions: many(15) }).issues.some((i) => i.code === "shows_answers")).toBe(false);
  });

  it("warns about heavy overlap with other tests", () => {
    expect(checkContent({ ...base, overlapPercent: 60, questions: many(15) }).issues[0].code).toBe("overlap");
  });
});

describe("checkLive", () => {
  const cls = (over = {}) => ({ id: "c1", name: "Year 4 Gold", students: 20, studentsWithoutPhoto: 0, scheduledDay: null, otherWindowsThatDay: 0, ...over });
  it("is ready when the class has students and the teacher is approved, even before a date is set", () => {
    const [r] = checkLive([cls()], new Set(["c1"]));
    expect(r.ready).toBe(true);
    expect(r.notes).toEqual(["No date set yet"]);
  });
  it("flags empty classes, missing photos, unapproved teachers and busy days", () => {
    expect(checkLive([cls({ students: 0 })], new Set(["c1"]))[0].ready).toBe(false);
    expect(checkLive([cls({ studentsWithoutPhoto: 5 })], new Set(["c1"]))[0].notes.join()).toMatch(/5 of 20 students have no photo/);
    expect(checkLive([cls()], new Set())[0].ready).toBe(false);
    expect(checkLive([cls({ scheduledDay: "2026-10-10", otherWindowsThatDay: 2 })], new Set(["c1"]))[0].notes.join()).toMatch(/3 exams that day/);
  });
});

describe("overlapPercent", () => {
  it("is the share of questions found elsewhere", () => {
    expect(overlapPercent(["a", "b", "c", "d"], new Set(["a", "b"]))).toBe(50);
    expect(overlapPercent([], new Set(["a"]))).toBe(0);
  });
});
