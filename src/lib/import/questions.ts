// Question file parsers. All formats end up as the same ParsedQuestion shape and go through the
// same validation, so teachers get identical error messages whichever format they use.
import Papa from "papaparse";
import { z } from "zod";
import { parseLenient } from "./lenient-json";

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
  /** Things that were tidied up automatically (shown as information, not errors). */
  notes?: string[];
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
  if (byText) return byText.key;
  const prefixed = /^\(?([A-Fa-f])\s*[.):\-]\s*\S/.exec(s);
  if (prefixed && options.some((o) => o.key === prefixed[1].toUpperCase())) return prefixed[1].toUpperCase();
  return null;
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
// JSON. Staff mostly copy and paste it from ChatGPT, Word or WhatsApp, so it is read forgivingly
// (see lenient-json.ts) and field names are flexible:
//   a list, { "questions": [...] }, one question, or several pasted one after another;
//   options as a list of texts, a list of { text }, or { "A": "...", "B": "..." };
//   the answer as a letter, "B. Mitochondria", the option's text, a number, or a "correct": true flag.
// ---------------------------------------------------------------------------
const KEY_ALIASES: Record<string, string[]> = {
  body: ["question", "body", "text", "q", "prompt", "stem", "title", "questiontext", "question_text", "questions"],
  options: ["options", "choices", "answers", "alternatives", "option_list", "optionlist"],
  answer: ["answer", "correct", "correct_answer", "correctanswer", "correct_option", "correctoption", "answer_key", "answerkey", "right_answer", "correct_choice", "key"],
  topic: ["topic", "subtopic", "category", "chapter", "unit"],
  difficulty: ["difficulty", "level"],
  explanation: ["explanation", "rationale", "feedback", "reason", "solution"],
  image: ["image_url", "image", "imageurl", "img", "picture"],
};

function pick(q: Record<string, unknown>, field: keyof typeof KEY_ALIASES): unknown {
  const lower = new Map(Object.keys(q).map((k) => [k.toLowerCase().replace(/[\s-]+/g, "_"), k]));
  for (const alias of KEY_ALIASES[field]) {
    const k = lower.get(alias);
    if (k !== undefined && q[k] != null && q[k] !== "") return q[k];
  }
  return undefined;
}

function looksLikeQuestion(v: unknown): v is Record<string, unknown> {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const o = v as Record<string, unknown>;
  const hasBody = pick(o, "body") !== undefined && typeof pick(o, "body") !== "object";
  const hasOpts = pick(o, "options") !== undefined || Object.keys(o).some((k) => /^(option_?)?[a-f]$/i.test(k));
  return hasBody && hasOpts;
}

/** Finds the questions wherever they sit: top-level list, { questions }, { quiz: { questions } }, one object… */
function findQuestions(v: unknown, depth = 0): unknown[] {
  if (Array.isArray(v)) return v.flatMap((x) => (Array.isArray(x) ? findQuestions(x, depth + 1) : looksLikeQuestion(x) || typeof x !== "object" || !x ? [x] : hasQuestionList(x) && depth < 3 ? findQuestions(x, depth + 1) : [x]));
  if (!v || typeof v !== "object") return [];
  if (looksLikeQuestion(v)) return [v];
  const o = v as Record<string, unknown>;
  const keys = Object.keys(o);
  const preferred = keys.find((k) => /^(questions|items|data|quiz|results|exam|test)$/i.test(k) && o[k] && typeof o[k] === "object");
  const first = preferred ?? keys.find((k) => Array.isArray(o[k]) && (o[k] as unknown[]).some((x) => x && typeof x === "object"));
  if (first && depth < 4) return findQuestions(o[first], depth + 1);
  return [v];
}
function hasQuestionList(v: unknown) {
  return Boolean(v && typeof v === "object" && Object.values(v as object).some((x) => Array.isArray(x)));
}

const LETTER_PREFIX = /^\s*\(?([A-Fa-f])\s*[.):\-]\s+/;

/** Options as people really write them → plain texts in order, plus the one flagged correct (if any). */
function readOptions(q: Record<string, unknown>): { texts: unknown[]; flagged: number | null } {
  const raw = pick(q, "options");
  let texts: unknown[] = [];
  let flagged: number | null = null;
  const textOf = (o: unknown): unknown => {
    if (o && typeof o === "object") {
      const r = o as Record<string, unknown>;
      return r.text ?? r.option ?? r.value ?? r.content ?? r.answer ?? r.label ?? r.body ?? "";
    }
    return o;
  };
  if (Array.isArray(raw)) {
    texts = raw.map(textOf);
    raw.forEach((o, i) => {
      if (o && typeof o === "object") {
        const r = o as Record<string, unknown>;
        const flag = r.correct ?? r.is_correct ?? r.isCorrect ?? r.right ?? r.isRight;
        if (flag === true || String(flag).toLowerCase() === "true") flagged = i;
      }
    });
  } else if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    const byLetter = OPTION_KEYS.map((k) => obj[k] ?? obj[k.toLowerCase()]);
    texts = byLetter.some((v) => v != null) ? byLetter.filter((v) => v != null).map(textOf) : Object.values(obj).map(textOf);
  } else if (typeof raw === "string") {
    // "A. one  B. two" or one option per line
    texts = raw.split(/\n|\s{2,}(?=[A-Fa-f][.)]\s)/).map((t) => t.trim()).filter(Boolean);
  } else {
    texts = OPTION_KEYS.map((k) => q[`option_${k.toLowerCase()}`] ?? q[`option${k}`] ?? q[`Option ${k}`] ?? q[k] ?? q[k.toLowerCase()]).filter((v) => v != null);
  }
  // "A. Nucleus", "B) Mitochondria": drop the letters when every option carries them in order.
  const strings = texts.map((t) => (typeof t === "string" ? t : null));
  if (strings.length >= 2 && strings.every((t, i) => t !== null && LETTER_PREFIX.exec(t)?.[1].toUpperCase() === OPTION_KEYS[i])) {
    texts = strings.map((t) => t!.replace(LETTER_PREFIX, ""));
  }
  return { texts, flagged };
}

const REPAIR_NOTES: Record<string, string> = {
  quotes: "Fixed curly or single quotation marks.",
  commas: "Fixed extra or missing commas.",
  unquoted: "Fixed names or words that were missing quotation marks.",
  comments: "Ignored comments in the text.",
  prose: "Ignored the extra words around your questions (like “Here are your questions”).",
  newlines: "Joined lines that had been broken in the middle of a question.",
  truncated: "The pasted text stopped early, so the last question was cut off and left out. Copy the whole thing again to get it.",
};

export function parseJson(content: string): ParseResult {
  let data: unknown[];
  const notes: string[] = [];
  const issues: ParseIssue[] = [];
  const text0 = content.replace(/^\uFEFF/, "");
  try {
    data = [JSON.parse(text0)];
  } catch {
    const r = parseLenient(text0);
    data = r.values;
    for (const code of r.repairs) if (REPAIR_NOTES[code]) notes.push(REPAIR_NOTES[code]);
    for (const s of r.skipped) issues.push({ source: s.where, message: s.message });
    if (data.length === 0) {
      return {
        questions: [],
        issues: [
          {
            source: "file",
            message: `Not valid JSON — it could not be read${r.skipped[0] ? `: ${r.skipped[0].message}` : ""}. Copy the questions again from where you got them, including the very first [ and the very last ].`,
          },
        ],
      };
    }
  }
  const list = data.flatMap((v) => findQuestions(v));
  if (list.length === 0) {
    return { questions: [], issues: [...issues, { source: "file", message: 'No questions found. Expected a list like [ { "question": "…", "options": [ … ], "answer": "B" } ].' }] };
  }
  // If any answer is the number 0, the file counts options from 0 (0 = A); otherwise 1 = A.
  const numericAnswers = list.map((q) => (q && typeof q === "object" ? pick(q as Record<string, unknown>, "answer") : undefined)).filter((a) => typeof a === "number" || (typeof a === "string" && /^\d$/.test(a.trim())));
  const zeroBased = numericAnswers.some((a) => Number(a) === 0);
  if (zeroBased) notes.push("Answers given as numbers were counted from 0 (0 = A, 1 = B).");

  const raws: RawQuestion[] = list.map((item, i) => {
    const source = `question ${i + 1}`;
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return { body: typeof item === "string" ? item : "", options: [], source };
    }
    const q = item as Record<string, unknown>;
    const { texts, flagged } = readOptions(q);
    let answer = pick(q, "answer");
    if (typeof answer === "number" || (typeof answer === "string" && /^\d$/.test(answer.trim()))) {
      const n = Number(answer);
      answer = OPTION_KEYS[zeroBased ? n : n - 1] ?? answer;
    }
    if ((answer === undefined || answer === "") && flagged !== null) answer = OPTION_KEYS[flagged];
    const explanation = pick(q, "explanation");
    return {
      body: pick(q, "body"),
      options: texts,
      answer,
      topic: pick(q, "topic"),
      difficulty: pick(q, "difficulty"),
      explanation,
      image_url: pick(q, "image"),
      source,
    };
  });
  const result = finalize(raws);
  return { questions: result.questions, issues: [...issues, ...result.issues], notes };
}

/** Pasted or uploaded text of unknown kind: JSON (even with chatter or code fences around it) or plain "Aiken" text. */
export function looksLikeJson(content: string) {
  const t = content.replace(/^\uFEFF/, "").trimStart();
  if (/^[[{]/.test(t) || /^```/.test(t)) return true;
  return /[[{]/.test(t) && /["“']\s*(question|options|answer|choices)\s*["”']?\s*:/i.test(t);
}

export function parseText(content: string): ParseResult {
  return looksLikeJson(content) ? parseJson(content) : parseAiken(content);
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
