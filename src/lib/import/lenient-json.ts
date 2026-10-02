// A forgiving JSON reader for text that people copy and paste from ChatGPT, Word, WhatsApp or Notes.
// It reads everything strict JSON.parse accepts, plus the usual damage from copying:
//   • curly “smart” quotes and 'single quotes' • trailing or missing commas • // and /* */ comments
//   • unquoted names • ```json code fences and chatty text around the data • raw line breaks inside text
//   • several arrays/objects pasted one after another • text that was cut off at the end
// One broken question is skipped and reported; the others still come through.

export interface LenientResult {
  /** Top-level values found, in order. */
  values: unknown[];
  /** Short codes for what was repaired (see parseJson for the wording shown to people). */
  repairs: Set<string>;
  /** Problems with individual pieces that were skipped. */
  skipped: { where: string; message: string }[];
  truncated: boolean;
}

class ReadError extends Error {
  constructor(
    message: string,
    public pos: number,
  ) {
    super(message);
  }
}

const OPEN_QUOTES = new Set(['"', "“", "”", "„", "'", "‘", "’"]);
const DOUBLE_LIKE = ['"', "”", "“", "„"];
const SINGLE_LIKE = ["'", "’", "‘"];

export function parseLenient(input: string): LenientResult {
  const src = input.replace(/^﻿/, "").replace(/[​-‍⁠﻿]/g, "").replace(/ /g, " ").replace(/\r\n?/g, "\n");
  const repairs = new Set<string>();
  const skipped: LenientResult["skipped"] = [];
  const values: unknown[] = [];
  let p = 0;
  let eof = 0; // how many times the text ended while something was still open

  const lineOf = (i: number) => src.slice(0, i).split("\n").length;
  const err = (msg: string, at = p) => new ReadError(`${msg} (line ${lineOf(at)})`, at);

  function skipSpace() {
    for (;;) {
      while (p < src.length && /\s/.test(src[p])) p++;
      if (src.startsWith("//", p)) {
        repairs.add("comments");
        while (p < src.length && src[p] !== "\n") p++;
      } else if (src.startsWith("/*", p)) {
        repairs.add("comments");
        const end = src.indexOf("*/", p + 2);
        p = end < 0 ? src.length : end + 2;
      } else return;
    }
  }

  function readString(): string {
    const open = src[p];
    const closers = SINGLE_LIKE.includes(open) ? SINGLE_LIKE : DOUBLE_LIKE;
    if (open !== '"') repairs.add("quotes");
    p++;
    let out = "";
    while (p < src.length) {
      const c = src[p];
      if (c === "\\") {
        const n = src[p + 1];
        p += 2;
        if (n === undefined) break;
        if (n === "n") out += "\n";
        else if (n === "t") out += "\t";
        else if (n === "r") out += "";
        else if (n === "b" || n === "f") out += " ";
        else if (n === "u" && /^[0-9a-fA-F]{4}$/.test(src.slice(p, p + 4))) {
          out += String.fromCharCode(parseInt(src.slice(p, p + 4), 16));
          p += 4;
        } else if (n === "\n") out += " ";
        else out += n;
        continue;
      }
      if (closers.includes(c)) {
        // It ends the text only if what follows could legally follow a string; otherwise it's a quote inside the text.
        let q = p + 1;
        while (q < src.length && (src[q] === " " || src[q] === "\t")) q++;
        const next = src[q];
        let k = q;
        if (next === "\n") while (k < src.length && /\s/.test(src[k])) k++;
        const newlineThen = next === "\n" && (k >= src.length || /["'“”‘’{[\w,}\]:]/.test(src[k]));
        // A comma left out between two texts ("a" "b" or "question": "x" "options": …) also ends this one.
        const nextIsString = /^["“”'‘’][^"“”'‘’\n]{0,60}["“”'‘’]\s*[,}\]:]/.test(src.slice(q, q + 80));
        if (next === undefined || /[,}\]:]/.test(next) || newlineThen || nextIsString) {
          p++;
          return out;
        }
        out += c;
        p++;
        continue;
      }
      if (c === "\n") {
        repairs.add("newlines");
        out += " ";
        p++;
        continue;
      }
      out += c;
      p++;
    }
    eof++;
    repairs.add("truncated");
    return out;
  }

  function readBare(): unknown {
    const m = /^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?(?=\s*[,}\]\n]|\s*$)/.exec(src.slice(p, p + 40));
    if (m) {
      p += m[0].length;
      return Number(m[0]);
    }
    const lit = /^(true|false|null)(?![\w])/i.exec(src.slice(p, p + 6));
    if (lit) {
      p += lit[0].length;
      return lit[1].toLowerCase() === "null" ? null : lit[1].toLowerCase() === "true";
    }
    // Unquoted text: read to the end of the line or the next separator.
    let q = p;
    while (q < src.length && !",}]\n".includes(src[q])) q++;
    const raw = src.slice(p, q).trim();
    if (!raw) throw err("Unexpected character");
    repairs.add("unquoted");
    p = q;
    return raw;
  }

  function readValue(): unknown {
    skipSpace();
    if (p >= src.length) {
      eof++;
      repairs.add("truncated");
      return null;
    }
    const c = src[p];
    if (c === "{") return readObject();
    if (c === "[") return readArray();
    if (OPEN_QUOTES.has(c)) return readString();
    return readBare();
  }

  function readObject(): Record<string, unknown> {
    p++;
    const obj: Record<string, unknown> = {};
    for (;;) {
      skipSpace();
      if (p >= src.length) {
        eof++;
        repairs.add("truncated");
        return obj;
      }
      if (src[p] === "}") {
        p++;
        return obj;
      }
      if (src[p] === ",") {
        repairs.add("commas");
        p++;
        continue;
      }
      let key: string;
      if (OPEN_QUOTES.has(src[p])) key = readString();
      else {
        const m = /^[A-Za-z_][\w\- ]*/.exec(src.slice(p));
        if (!m) throw err("Expected a name here");
        key = m[0].trimEnd();
        p += key.length;
        repairs.add("unquoted");
      }
      skipSpace();
      if (src[p] === ":" || src[p] === "=") p++;
      else if (p >= src.length) {
        eof++;
        return obj;
      } else throw err(`Expected “:” after “${key}”`);
      const before = eof;
      obj[key] = readValue();
      if (eof > before) return obj;
      skipSpace();
      if (src[p] === ",") {
        p++;
        skipSpace();
        if (src[p] === "}") repairs.add("commas");
      } else if (src[p] !== "}" && p < src.length) {
        // A comma was left out between two entries (the next entry starts on its own).
        if (OPEN_QUOTES.has(src[p]) || /[A-Za-z_]/.test(src[p])) repairs.add("commas");
        else throw err("Expected a comma");
      }
    }
  }

  function readArray(): unknown[] {
    p++;
    const arr: unknown[] = [];
    for (;;) {
      skipSpace();
      if (p >= src.length) {
        eof++;
        repairs.add("truncated");
        return arr;
      }
      if (src[p] === "]") {
        p++;
        return arr;
      }
      if (src[p] === ",") {
        repairs.add("commas");
        p++;
        continue;
      }
      const start = p;
      const before = eof;
      try {
        const v = readValue();
        if (eof > before) {
          // The text ended inside this item: it is incomplete, so leave it out.
          return arr;
        }
        arr.push(v);
      } catch (e) {
        if (!(e instanceof ReadError)) throw e;
        skipped.push({ where: `item ${arr.length + skipped.length + 1} (line ${lineOf(start)})`, message: e.message });
        // Carry on from the next item that starts on a new line or after a closing brace.
        const rest = src.slice(Math.max(e.pos, start + 1));
        const m = /\}\s*,?\s*\{|\n\s*\{/.exec(rest);
        if (!m) {
          p = src.length;
          return arr;
        }
        p = Math.max(e.pos, start + 1) + m.index + m[0].lastIndexOf("{");
        continue;
      }
      skipSpace();
      if (src[p] === ",") {
        p++;
        skipSpace();
        if (src[p] === "]") repairs.add("commas");
      } else if (src[p] !== "]" && p < src.length) {
        if (src[p] === "{" || src[p] === "[" || OPEN_QUOTES.has(src[p])) repairs.add("commas");
        else {
          skipped.push({ where: `line ${lineOf(p)}`, message: "Unexpected text between items" });
          while (p < src.length && src[p] !== "{" && src[p] !== "]") p++;
        }
      }
    }
  }

  // Top level: look for the first [ or { and read values one after another, skipping any text in between.
  const firstBracket = src.search(/[[{]/);
  if (firstBracket < 0) return { values, repairs, skipped: [{ where: "file", message: "No questions found — nothing here starts with [ or {." }], truncated: false };
  if (src.slice(0, firstBracket).replace(/```\w*/g, "").trim()) repairs.add("prose");
  p = firstBracket;
  while (p < src.length) {
    skipSpace();
    if (p >= src.length) break;
    if (src[p] === "[" || src[p] === "{") {
      const before = eof;
      try {
        const v = readValue();
        // A top-level value that ran out of text is kept only if it holds complete items (readArray already dropped the cut-off one).
        if (v !== null && (eof === before || (Array.isArray(v) && v.length) || (v && typeof v === "object" && Object.keys(v).length))) values.push(v);
      } catch (e) {
        if (!(e instanceof ReadError)) throw e;
        skipped.push({ where: `line ${lineOf(e.pos)}`, message: e.message });
        const next = src.slice(e.pos + 1).search(/[[{]/);
        if (next < 0) break;
        p = e.pos + 1 + next;
      }
    } else {
      // Text between pieces: a closing code fence, a sentence, a comma.
      const m = /^[^[{]*/.exec(src.slice(p))!;
      const stray = m[0].replace(/```\w*/g, "").replace(/[,;\s]/g, "");
      if (stray) repairs.add("prose");
      p += Math.max(m[0].length, 1);
    }
  }
  return { values, repairs, skipped, truncated: repairs.has("truncated") };
}
