import { describe, expect, it } from "vitest";
import { parseAiken, parseCsv, parseJson, resolveAnswer } from "@/lib/import/questions";

describe("parseCsv", () => {
  it("reads the template columns and flexible headings", () => {
    const csv = [
      "Question,Option A,Option B,Option C,Option D,Answer,Topic,Difficulty",
      '"What is 2 + 2?",3,4,5,6,B,Arithmetic,easy',
      "Capital of Nigeria?,Lagos,Abuja,Kano,,abuja,Geography,",
    ].join("\n");
    const r = parseCsv(csv);
    expect(r.issues).toEqual([]);
    expect(r.questions).toHaveLength(2);
    expect(r.questions[0]).toMatchObject({ answer: "B", topic: "Arithmetic", difficulty: 1 });
    expect(r.questions[1].options).toHaveLength(3);
    expect(r.questions[1].answer).toBe("B"); // matched by option text
  });

  it("reports row numbers for bad rows and skips blank rows", () => {
    const csv = ["question,a,b,c,answer", "Q1,x,y,z,E", ",,,,", "Q3,x,,z,A", "Q4,only,,,A"].join("\n");
    const r = parseCsv(csv);
    expect(r.questions).toHaveLength(0);
    expect(r.issues.map((i) => i.source)).toEqual(["row 2", "row 4", "row 5"]);
    expect(r.issues[0].message).toMatch(/doesn't match/);
    expect(r.issues[1].message).toMatch(/without gaps/);
  });

  it("rejects files without a question column", () => {
    expect(parseCsv("foo,bar\n1,2").issues[0].message).toMatch(/question/);
  });
});

describe("parseAiken", () => {
  it("parses Aiken blocks with metadata and wrapped question text", () => {
    const txt = `1. What is the powerhouse
of the cell?
A. Nucleus
B. Mitochondria
C. Ribosome
ANSWER: B
TOPIC: Cells
EXPLANATION: It makes ATP.

Which is a noble gas?
a) Oxygen
b) Neon
Answer - b`;
    const r = parseAiken(txt);
    expect(r.issues).toEqual([]);
    expect(r.questions).toHaveLength(2);
    expect(r.questions[0]).toMatchObject({
      body: "What is the powerhouse\nof the cell?",
      answer: "B",
      topic: "Cells",
      explanation: "It makes ATP.",
    });
    expect(r.questions[1].answer).toBe("B");
  });

  it("accepts a * marker for the right option", () => {
    const r = parseAiken("Pick two\nA. one\n*B. two\nC. three\n");
    expect(r.questions[0].answer).toBe("B");
  });

  it("reports a missing answer", () => {
    const r = parseAiken("Q?\nA. x\nB. y\n\nQ2?\nA. x\nB. y\nANSWER: A");
    expect(r.questions).toHaveLength(1);
    expect(r.issues[0].message).toMatch(/missing/);
  });
});

describe("parseJson", () => {
  it("accepts arrays with option arrays or objects", () => {
    const r = parseJson(
      JSON.stringify({
        questions: [
          { question: "Q1", options: ["x", "y"], answer: "A" },
          { body: "Q2", options: { A: "x", B: "y", C: "z" }, answer: 3, difficulty: "hard" },
        ],
      }),
    );
    expect(r.issues).toEqual([]);
    expect(r.questions[1]).toMatchObject({ answer: "C", difficulty: 3 });
  });

  it("reports invalid JSON", () => {
    expect(parseJson("{nope").issues[0].message).toMatch(/Not valid JSON/);
  });
});

describe("resolveAnswer", () => {
  const opts = [
    { key: "A", text: "Red" },
    { key: "B", text: "Blue" },
  ];
  it.each([
    ["b", "B"],
    ["(A)", "A"],
    ["Option B", "B"],
    ["2", "B"],
    ["blue", "B"],
    ["C", null],
    ["", null],
  ])("%s → %s", (input, expected) => {
    expect(resolveAnswer(input, opts)).toBe(expected);
  });
});
