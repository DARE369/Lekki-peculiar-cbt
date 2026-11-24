import { describe, expect, it } from "vitest";
import { csvSafe, groupCalcUses, parseCalcEvent, type CalcUse } from "@/lib/calculator-log";

const row = (detail: unknown) => ({ attempt_id: "a1", created_at: "2026-11-24T10:00:00Z", detail });

describe("reading calculator log entries from a student's browser", () => {
  it("reads a good entry", () => {
    expect(parseCalcEvent(row({ q: "q-1", n: 7, expr: "(2+3)×4", result: "20", at: "2026-11-24T10:05:00.000Z" }))).toEqual({
      attemptId: "a1",
      at: "2026-11-24T10:05:00.000Z",
      questionId: "q-1",
      shownAs: 7,
      expr: "(2+3)×4",
      result: "20",
    });
  });
  it("falls back to the time the server received it when the entry's own time is missing or nonsense", () => {
    expect(parseCalcEvent(row({ q: "q", expr: "1+1", result: "2" }))?.at).toBe("2026-11-24T10:00:00Z");
    expect(parseCalcEvent(row({ q: "q", expr: "1+1", result: "2", at: "not a date" }))?.at).toBe("2026-11-24T10:00:00Z");
  });
  it("ignores entries that are not a sum with an answer", () => {
    expect(parseCalcEvent(row(null))).toBeNull();
    expect(parseCalcEvent(row("text"))).toBeNull();
    expect(parseCalcEvent(row({ q: "q", expr: "1+1" }))).toBeNull();
    expect(parseCalcEvent(row({ q: "q", result: "2" }))).toBeNull();
    expect(parseCalcEvent(row({ expr: 5, result: 10 }))).toBeNull();
  });
  it("shortens anything absurdly long instead of showing it", () => {
    const u = parseCalcEvent(row({ q: "q".repeat(500), expr: "1".repeat(500), result: "9".repeat(500), n: 3 }))!;
    expect(u.expr).toHaveLength(80);
    expect(u.result).toHaveLength(40);
    expect(u.questionId).toHaveLength(40);
  });
  it("drops entries that did not come from the calculator, such as crafted text or spreadsheet formulas", () => {
    expect(parseCalcEvent(row({ q: "q", expr: "=HYPERLINK(\"http://x\")", result: "1" }))).toBeNull();
    expect(parseCalcEvent(row({ q: "q", expr: "1+1", result: "=cmd|' /C calc'!A0" }))).toBeNull();
    expect(parseCalcEvent(row({ q: "q", expr: "<script>alert(1)</script>", result: "2" }))).toBeNull();
    expect(parseCalcEvent(row({ q: "q", expr: "1+1", result: "two" }))).toBeNull();
  });
  it("accepts every symbol the calculator can produce, including negative and very small answers", () => {
    expect(parseCalcEvent(row({ q: "q", expr: "−3×(2.5÷5)", result: "-1.5" }))).not.toBeNull();
    expect(parseCalcEvent(row({ q: "q", expr: "1÷3", result: "1e-9" }))).not.toBeNull();
  });
  it("only accepts a real number for the question number", () => {
    expect(parseCalcEvent(row({ expr: "1", result: "1", n: "7" }))?.shownAs).toBeNull();
    expect(parseCalcEvent(row({ expr: "1", result: "1", n: 7.9 }))?.shownAs).toBe(7);
  });
});

describe("spreadsheet safety", () => {
  it("defuses cells that start like a formula", () => {
    for (const bad of ["=1+1", "+1", "-3+5", "@SUM(A1)", "\tx"]) expect(csvSafe(bad).startsWith("'")).toBe(true);
    expect(csvSafe("Year 4")).toBe("Year 4");
    expect(csvSafe("3+5")).toBe("3+5");
  });
});

describe("grouping calculator use for review", () => {
  const use = (attemptId: string, questionId: string, at: string, expr = "1+1"): CalcUse => ({ attemptId, questionId, shownAs: 1, at, expr, result: "2" });
  it("lists each student's sums in the order they happened", () => {
    const g = groupCalcUses([use("a", "q1", "2026-11-24T10:05:00Z", "late"), use("a", "q2", "2026-11-24T10:01:00Z", "early"), use("b", "q1", "2026-11-24T10:03:00Z")]);
    expect(g.byAttempt.get("a")!.map((u) => u.expr)).toEqual(["early", "late"]);
    expect(g.byAttempt.get("b")).toHaveLength(1);
  });
  it("counts, for each question, how many sums and how many different students", () => {
    const g = groupCalcUses([use("a", "q1", "2026-11-24T10:01:00Z"), use("a", "q1", "2026-11-24T10:02:00Z"), use("b", "q1", "2026-11-24T10:03:00Z"), use("b", "q2", "2026-11-24T10:04:00Z")]);
    expect(g.questions.find((q) => q.questionId === "q1")).toEqual({ questionId: "q1", uses: 3, students: 2 });
    expect(g.questions.find((q) => q.questionId === "q2")).toEqual({ questionId: "q2", uses: 1, students: 1 });
  });
  it("copes with no use at all", () => {
    const g = groupCalcUses([]);
    expect(g.byAttempt.size).toBe(0);
    expect(g.questions).toEqual([]);
  });
});
