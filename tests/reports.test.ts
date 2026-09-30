import { describe, expect, it } from "vitest";
import { distribution, itemAnalysis, ordinal, positions, summarize, toCsv } from "@/lib/reports";

describe("summarize", () => {
  it("computes mean, median, range and pass rate", () => {
    expect(summarize([40, 50, 60, 90], 50)).toEqual({ count: 4, mean: 60, median: 55, high: 90, low: 40, passRate: 75 });
    expect(summarize([], 50).mean).toBeNull();
  });
});

describe("distribution", () => {
  it("puts 100 in the top bucket", () => {
    const d = distribution([0, 9, 10, 99, 100]);
    expect(d[0].count).toBe(2);
    expect(d[1].count).toBe(1);
    expect(d[9]).toEqual({ label: "90–100", count: 2 });
  });
});

describe("positions", () => {
  it("uses competition ranking for ties", () => {
    const rows = [{ v: 80 }, { v: 90 }, { v: 80 }, { v: 70 }, { v: null }];
    const p = positions(rows, (r) => r.v);
    expect(rows.map((r) => p.get(r))).toEqual([2, 1, 2, 4, undefined]);
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 101].map(ordinal)).toEqual([
      "1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "101st",
    ]);
  });
});

describe("itemAnalysis", () => {
  const q = (id: string, answer: string) => ({
    id,
    body: id,
    answer,
    topic: null,
    options: ["A", "B", "C", "D"].map((key) => ({ key, text: key })),
  });
  it("counts correct, unanswered and options only for students who saw the question", () => {
    const attempts = Array.from({ length: 6 }, (_, i) => ({ id: `t${i}`, question_order: [{ q: "q1", o: [] }] }));
    attempts.push({ id: "t6", question_order: [{ q: "q2", o: [] }] });
    const answers = [
      { attempt_id: "t0", question_id: "q1", selected: "C" },
      { attempt_id: "t1", question_id: "q1", selected: "C" },
      { attempt_id: "t2", question_id: "q1", selected: "C" },
      { attempt_id: "t3", question_id: "q1", selected: "B" },
      { attempt_id: "t4", question_id: "q1", selected: null },
    ];
    const [s1, s2] = itemAnalysis([q("q1", "B"), q("q2", "A")], attempts, answers);
    expect(s1).toMatchObject({ seen: 6, correct: 1, unanswered: 2, pctCorrect: 16.7, suspicious: true });
    expect(s1.topDistractor).toEqual({ key: "C", count: 3 });
    expect(s2).toMatchObject({ seen: 1, correct: 0, unanswered: 1, suspicious: false });
  });
});

describe("toCsv", () => {
  it("quotes when needed", () => {
    expect(toCsv([["a", 'b "c"', "d,e", null, 3]])).toBe('a,"b ""c""","d,e",,3');
  });
});

import { buildBroadsheet } from "@/lib/reports";

describe("buildBroadsheet", () => {
  const at = (student_id: string, subject_id: string, id: string, score: number) => ({
    student_id,
    score,
    max_score: 10,
    assessment: { id, title: id, subject_id },
  });
  const attempts = [
    at("charles", "bio", "bio-t1", 8),
    at("charles", "bio", "bio-t2", 6),
    at("charles", "fre", "fre-t1", 9),
    at("amaka", "bio", "bio-t1", 10),
  ];
  it("averages per subject and ranks students", () => {
    const b = buildBroadsheet(attempts, ["charles", "amaka", "absent"], "subject", (k) => k);
    const charles = b.rows.find((r) => r.studentId === "charles")!;
    expect(charles.cells).toEqual({ bio: 70, fre: 90 });
    expect(charles.average).toBe(80);
    expect(b.rows.find((r) => r.studentId === "amaka")!.position).toBe(1);
    expect(b.rows.find((r) => r.studentId === "absent")!).toMatchObject({ average: null, position: null });
    expect(b.columns.find((c) => c.key === "bio")!.classAverage).toBe(85);
  });
  it("can show individual tests", () => {
    const b = buildBroadsheet(attempts.filter((a) => a.assessment.subject_id === "bio"), ["charles"], "assessment", (k) => k);
    expect(b.columns.map((c) => c.key)).toEqual(["bio-t1", "bio-t2"]);
    expect(b.rows[0].cells).toEqual({ "bio-t1": 80, "bio-t2": 60 });
  });
});
