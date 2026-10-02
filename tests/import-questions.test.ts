import { describe, expect, it } from "vitest";
import { parseAiken, parseCsv, parseJson, resolveAnswer, parseText } from "@/lib/import/questions";

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

describe("parseJson: pasted from ChatGPT, Word and WhatsApp", () => {
  const Q = (n: number) => `{ "question": "Q${n}?", "options": ["a", "b", "c", "d"], "answer": "B" }`;

  it("reads text inside a ```json code fence with chat around it", () => {
    const r = parseJson("Sure! Here are your questions:\n\n```json\n[" + Q(1) + "," + Q(2) + "]\n```\n\nLet me know if you need more.");
    expect(r.issues).toEqual([]);
    expect(r.questions).toHaveLength(2);
    expect(r.notes?.join(" ")).toMatch(/extra words/);
  });

  it("fixes curly quotes from Word, WhatsApp and Notes", () => {
    const r = parseJson('[{ “question”: “What is 2 + 2?”, “options”: [“3”, “4”, “5”], “answer”: “B” }]');
    expect(r.issues).toEqual([]);
    expect(r.questions[0]).toMatchObject({ body: "What is 2 + 2?", answer: "B" });
    expect(r.notes?.join(" ")).toMatch(/quotation/);
  });

  it("keeps apostrophes and quotation marks inside the text", () => {
    const r = parseJson('[{"question": "Who said "I think, therefore I am"?", "options": ["Descartes", "Plato’s student"], "answer": "A"}]');
    expect(r.issues).toEqual([]);
    expect(r.questions[0].body).toBe('Who said "I think, therefore I am"?');
    expect(r.questions[0].options[1].text).toBe("Plato’s student");
  });

  it("accepts trailing commas, missing commas, comments and single quotes", () => {
    const r = parseJson(`[
      // first
      { 'question': 'Q1?', 'options': ['x', 'y',], 'answer': 'A', },
      { "question": "Q2?" "options": ["x", "y"] "answer": "B" }
    ]`);
    expect(r.issues).toEqual([]);
    expect(r.questions).toHaveLength(2);
  });

  it("accepts unquoted names", () => {
    const r = parseJson('[{question: "Q?", options: ["x", "y"], answer: "A"}]');
    expect(r.issues).toEqual([]);
    expect(r.questions).toHaveLength(1);
  });

  it("reads questions pasted one after another with no list around them", () => {
    const r = parseJson(Q(1) + ",\n" + Q(2) + "\n" + Q(3));
    expect(r.issues).toEqual([]);
    expect(r.questions).toHaveLength(3);
  });

  it("reads several lists pasted back to back", () => {
    const r = parseJson("[" + Q(1) + "]\n\n[" + Q(2) + "," + Q(3) + "]");
    expect(r.questions).toHaveLength(3);
  });

  it("keeps the complete questions when the pasted text was cut off", () => {
    const r = parseJson("[" + Q(1) + "," + Q(2) + ', { "question": "Q3?", "options": ["a", "b"');
    expect(r.questions).toHaveLength(2);
    expect(r.notes?.join(" ")).toMatch(/cut off/);
  });

  it("skips one broken question and keeps the rest", () => {
    const r = parseJson("[" + Q(1) + ',\n { "question": "Q2?" "options" ["a", "b"] },\n' + Q(3) + "]");
    expect(r.questions.map((q) => q.body)).toEqual(["Q1?", "Q3?"]);
    expect(r.issues).toHaveLength(1);
  });

  it("joins lines broken inside a question", () => {
    const r = parseJson('[{"question": "A very long\nquestion?", "options": ["x", "y"], "answer": "A"}]');
    expect(r.questions[0].body).toBe("A very long question?");
  });

  it("finds questions nested in other objects", () => {
    const r = parseJson(JSON.stringify({ quiz: { title: "T", questions: [JSON.parse(Q(1))] } }));
    expect(r.questions).toHaveLength(1);
    expect(parseJson(Q(1)).questions).toHaveLength(1);
  });

  it("understands other field names and option styles", () => {
    const r = parseJson(
      JSON.stringify([
        { prompt: "P1?", choices: ["A. red", "B. blue", "C. green"], correctAnswer: "B. blue" },
        { q: "P2?", options: [{ text: "x" }, { text: "y", correct: true }] },
        { question: "P3?", options: { a: "x", b: "y" }, correct_option: "a", category: "Maths", level: "easy" },
        { question: "P4?", option_a: "x", option_b: "y", option_c: "z", answer: "c" },
      ]),
    );
    expect(r.issues).toEqual([]);
    expect(r.questions.map((q) => q.answer)).toEqual(["B", "B", "A", "C"]);
    expect(r.questions[0].options.map((o) => o.text)).toEqual(["red", "blue", "green"]);
    expect(r.questions[2]).toMatchObject({ topic: "Maths", difficulty: 1 });
  });

  it("counts numeric answers from 0 only when the file uses 0", () => {
    const zero = parseJson('[{"question":"a","options":["x","y"],"answer":0},{"question":"b","options":["x","y"],"answer":1}]');
    expect(zero.questions.map((q) => q.answer)).toEqual(["A", "B"]);
    const one = parseJson('[{"question":"a","options":["x","y"],"answer":1},{"question":"b","options":["x","y"],"answer":2}]');
    expect(one.questions.map((q) => q.answer)).toEqual(["A", "B"]);
  });

  it("explains text that has no JSON in it", () => {
    expect(parseJson("hello there").issues[0].message).toMatch(/Not valid JSON/);
  });
});

describe("parseText", () => {
  it("sends JSON and plain questions to the right reader", () => {
    expect(parseText('```json\n[{"question":"Q?","options":["x","y"],"answer":"A"}]\n```').questions).toHaveLength(1);
    expect(parseText("What?\nA. x\nB. y\nANSWER: A").questions).toHaveLength(1);
  });
});
