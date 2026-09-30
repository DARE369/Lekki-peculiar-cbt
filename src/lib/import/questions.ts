// Question file parsers. All formats end up as the same ParsedQuestion shape and go through the
// same validation, so teachers get identical error messages whichever format they use.
import Papa from "papaparse";
import { z } from "zod";

export const OPTION_KEYS = ["A", "B", "C", "D", "E", "F"] as const;

export interface ParsedQuestion {
  body: string;
  options: { key: string; text: string }[];
  answer: string;
  topic: string | null;
  difficulty: 1 | 2 | 3 | null;
  explanation: string | null;
  image_url: string | null;
  /** Where it came from in the file, for error messages ("row 12", "question 3") */
  source: string;
}

export interface ParseIssue {
  source: string;
  message: string;
}

export interface ParseResult {
  questions: ParsedQuestion[];
  issues: ParseIssue[];
}

export const parsedQuestionSchema = z.object({
  body: z.string().trim().min(1).max(5000),
  options: z
    .array(z.object({ key: z.enum(OPTION_KEYS), text: z.string().trim().min(1).max(1000) }))
    .min(2)
    .max(6),
  answer: z.enum(OPTION_KEYS),
  topic: z.string().trim().max(200).nullable(),
  difficulty: z.union([z.literal(1), z.literal(2), z.literal(3)]).nullable(),
  explanation: z.string().trim().max(3000).nullable(),
  image_url: z.string().trim().url().max(2000).nullable(),
  source: z.string(),
});

// ---------------------------------------------------------------------------
// Shared normalisation
// ---------------------------------------------------------------------------
interface RawQuestion {
  body?: unknown;
  options: unknown[];
  answer?: unknown;
  topic?: unknown;
  difficulty?: unknown;
  explanation?: unknown;
  image_url?: unknown;
  source: string;
}

function text(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "object" && v !== null && "text" in v) return String((v as { text: unknown }).text ?? "").trim();
  if (typeof v === "object" && v !== null && "richText" in v) {
    return ((v as { richText: { text: string }[] }).richText ?? []).map((r) => r.text).join("").trim();
  }
  return String(v).trim();
}

function parseDifficulty(v: unknown): 1 | 2 | 3 | null {
  const s = text(v).toLowerCase();
  if (!s) return null;
  if (["1", "easy", "e", "low"].includes(s)) return 1;
  if (["2", "medium", "m", "moderate", "average"].includes(s)) return 2;
  if (["3", "hard", "h", "high", "difficult"].includes(s)) return 3;
  return null;
}

/** Accepts a letter (A-F, "a", "(b)", "Option C"), a number (1-6) or the exact text of an option. */
export function resolveAnswer(raw: unknown, options: { key: string; text: string }[]): string | null {
  const s = text(raw);
  if (!s) return null;
  const letter = s
    .replace(/^option\s*/i, "")
    .replace(/[().\s]/g, "")
    .toUpperCase();
  if (/^[A-F]$/.test(letter) && options.some((o) => o.key === letter)) return letter;
  if (/^[1-6]$/.test(letter)) {
    const k = OPTION_KEYS[Number(letter) - 1];
    if (options.some((o) => o.key === k)) return k;
  }
  const byText = options.find((o) => o.text.toLowerCase() === s.toLowerCase());
  return byText?.key ?? null;
}

function finalize(raws: RawQuestion[]): ParseResult {
  const questions: ParsedQuestion[] = [];
  const issues: ParseIssue[] = [];
  for (const r of raws) {
    const body = text(r.body);
    const allTexts = r.options.map(text);
    let last = allTexts.length - 1;
    while (last >= 0 && !allTexts[last]) last -= 1;
    const optionTexts = allTexts.slice(0, last + 1);
    if (!body && optionTexts.length === 0) continue; // blank row
    if (!body) {
      issues.push({ source: r.source, message: "The question text is empty." });
      continue;
    }
    if (optionTexts.some((t) => !t)) {
      issues.push({ source: r.source, message: "Options must be filled in order A, B, C… without gaps." });
      continue;
    }
    if (optionTexts.length < 2) {
      issues.push({ source: r.source, message: "Needs at least 2 options (A and B)." });
      continue;
    }
    if (optionTexts.length > 6) {
      issues.push({ source: r.source, message: "Has more than 6 options; the maximum is A–F." });
      continue;
    }
    const options = optionTexts.map((t, i) => ({ key: OPTION_KEYS[i], text: t }));
    const answer = resolveAnswer(r.answer, options);
    if (!answer) {
      const given = text(r.answer);
      issues.push({
        source: r.source,
        message: given
          ? `Answer "${given}" doesn't match any option. Use a letter like B.`
          : "The answer is missing. Add the correct letter, e.g. B.",
      });
      continue;
    }
    const image = text(r.image_url) || null;
    const candidate = {
      body,
      options,
      answer,
      topic: text(r.topic) || null,
      difficulty: parseDifficulty(r.difficulty),
      explanation: text(r.explanation) || null,
      image_url: image,
      source: r.source,
    };
    const checked = parsedQuestionSchema.safeParse(candidate);
    if (!checked.success) {
      const first = checked.error.issues[0];
      issues.push({ source: r.source, message: `${first.path.join(".") || "question"}: ${first.message}` });
      continue;
    }
    questions.push(checked.data as ParsedQuestion);
  }
  return { questions, issues };
}

// ---------------------------------------------------------------------------
// Tabular formats (CSV / Excel): flexible header names
// ---------------------------------------------------------------------------
const HEADER_ALIASES: Record<string, string> = {
  question: "body",
  questions: "body",
  "question text": "body",
  body: "body",
  stem: "body",
  answer: "answer",
  "correct answer": "answer",
  correct: "answer",
  key: "answer",
  topic: "topic",
  subtopic: "topic",
  difficulty: "difficulty",
  level: "difficulty",
  explanation: "explanation",
  solution: "explanation",
  image: "image_url",
  "image url": "image_url",
  image_url: "image_url",
};

function headerKey(h: string): string | null {
  const k = h.trim().toLowerCase().replace(/_/g, " ").replace(/\s+/g, " ");
  if (HEADER_ALIASES[k]) return HEADER_ALIASES[k];
  if (HEADER_ALIASES[k.replace(/ /g, "_")]) return HEADER_ALIASES[k.replace(/ /g, "_")];
  const opt = k.match(/^(?:option|opt|choice)?\s*([a-f])$/);
  if (opt) return `opt_${opt[1].toUpperCase()}`;
  return null;
}

export function parseTable(rows: unknown[][], firstDataRowNumber = 2): ParseResult {
  if (rows.length === 0) return { questions: [], issues: [{ source: "file", message: "The file is empty." }] };
  const header = rows[0].map((h) => headerKey(text(h)));
  if (!header.includes("body")) {
    return {
      questions: [],
      issues: [{ source: "header row", message: 'Could not find a "question" column. Use the template headings.' }],
    };
  }
  const raws: RawQuestion[] = rows.slice(1).map((row, i) => {
    const rec: Record<string, unknown> = {};
    header.forEach((k, col) => {
      if (k) rec[k] = row[col];
    });
    return {
      body: rec.body,
      options: OPTION_KEYS.map((k) => rec[`opt_${k}`]),
      answer: rec.answer,
      topic: rec.topic,
      difficulty: rec.difficulty,
      explanation: rec.explanation,
      image_url: rec.image_url,
      source: `row ${i + firstDataRowNumber}`,
    };
  });
  return finalize(raws);
}

export function parseCsv(content: string): ParseResult {
  const parsed = Papa.parse<string[]>(content.replace(/^\uFEFF/, ""), { skipEmptyLines: false });
  return parseTable(parsed.data);
}

// ---------------------------------------------------------------------------
// Plain text ("Aiken" style, very forgiving)
//
//   What is the powerhouse of the cell?
//   A. Nucleus
//   B. Mitochondria
//   ANSWER: B
//   TOPIC: Cells            (optional)
//   EXPLANATION: ...        (optional)
//
// Also accepts "A)", "(a)", "a -", and marking the correct option with a leading * instead of ANSWER.
// ---------------------------------------------------------------------------
const OPTION_LINE = /^\s*(\*)?\s*\(?([A-Fa-f])\s*[.):\-]\s*(.+)$/;
const META_LINE = /^\s*(answer|ans|correct answer|topic|difficulty|explanation|image)\s*[:\-=]\s*(.*)$/i;

export function parseAiken(content: string): ParseResult {
  const lines = content.replace(/\r\n?/g, "\n").split("\n");
  const raws: RawQuestion[] = [];
  let cur: (RawQuestion & { bodyLines: string[]; starred?: string; expected: number }) | null = null;
  let n = 0;

  const flush = () => {
    if (!cur) return;
    cur.body = cur.bodyLines.join("\n").trim().replace(/^\s*(?:q(?:uestion)?\s*)?\d+\s*[.):]\s*/i, "");
    if (!cur.answer && cur.starred) cur.answer = cur.starred;
    raws.push(cur);
    cur = null;
  };

  lines.forEach((line, idx) => {
    const trimmed = line.trim();
    if (!trimmed) {
      // Blank line ends a question only once it has options (question text may span paragraphs).
      if (cur && cur.options.length > 0) flush();
      return;
    }
    const meta = trimmed.match(META_LINE);
    if (meta && cur && cur.options.length > 0) {
      const key = meta[1].toLowerCase();
      if (key.startsWith("ans") || key === "correct answer") cur.answer = meta[2];
      else if (key === "topic") cur.topic = meta[2];
      else if (key === "difficulty") cur.difficulty = meta[2];
      else if (key === "explanation") cur.explanation = meta[2];
      else if (key === "image") cur.image_url = meta[2];
      return;
    }
    const opt = trimmed.match(OPTION_LINE);
    if (cur && opt && opt[2].toUpperCase() === OPTION_KEYS[cur.expected]) {
      cur.options.push(opt[3]);
      if (opt[1]) cur.starred = opt[2].toUpperCase();
      cur.expected += 1;
      return;
    }
    if (cur && cur.options.length > 0) {
      // Option text wrapped onto a new line.
      if (!cur.answer) {
        cur.options[cur.options.length - 1] = `${text(cur.options[cur.options.length - 1])} ${trimmed}`;
        return;
      }
      flush();
    }
    if (!cur) {
      n += 1;
      cur = { bodyLines: [], options: [], source: `question ${n} (line ${idx + 1})`, expected: 0 };
    }
    cur.bodyLines.push(trimmed);
  });
  flush();
  return finalize(raws);
}

// ---------------------------------------------------------------------------
// JSON: an array, or { "questions": [...] }. Options as an array or { "A": "...", ... }.
// ---------------------------------------------------------------------------
export function parseJson(content: string): ParseResult {
  let data: unknown;
  try {
    data = JSON.parse(content);
  } catch (e) {
    return { questions: [], issues: [{ source: "file", message: `Not valid JSON: ${(e as Error).message}` }] };
  }
  const list = Array.isArray(data)
    ? data
    : data && typeof data === "object" && Array.isArray((data as { questions?: unknown }).questions)
      ? (data as { questions: unknown[] }).questions
      : null;
  if (!list) {
    return { questions: [], issues: [{ source: "file", message: 'Expected a list of questions or { "questions": [...] }.' }] };
  }
  const raws: RawQuestion[] = list.map((item, i) => {
    const q = (item ?? {}) as Record<string, unknown>;
    let options: unknown[] = [];
    if (Array.isArray(q.options)) {
      options = q.options.map((o) => (o && typeof o === "object" && "text" in o ? (o as { text: unknown }).text : o));
    } else if (q.options && typeof q.options === "object") {
      const obj = q.options as Record<string, unknown>;
      options = OPTION_KEYS.map((k) => obj[k] ?? obj[k.toLowerCase()]).filter((v) => v != null);
    } else {
      options = OPTION_KEYS.map((k) => q[`option_${k.toLowerCase()}`] ?? q[k] ?? q[k.toLowerCase()]).filter((v) => v != null);
    }
    return {
      body: q.question ?? q.body ?? q.text,
      options,
      answer: q.answer ?? q.correct ?? q.correct_answer,
      topic: q.topic,
      difficulty: q.difficulty,
      explanation: q.explanation,
      image_url: q.image_url ?? q.image,
      source: `question ${i + 1}`,
    };
  });
  return finalize(raws);
}

export type ImportFormat = "xlsx" | "csv" | "txt" | "json";

export function detectFormat(filename: string, content?: string): ImportFormat {
  const ext = filename.toLowerCase().split(".").pop();
  if (ext === "xlsx") return "xlsx";
  if (ext === "csv") return "csv";
  if (ext === "json") return "json";
  if (content && /^\s*[[{]/.test(content)) return "json";
  return "txt";
}

/** Normalised text used to spot duplicates already in the bank. */
export function dedupeKey(body: string) {
  return body.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
