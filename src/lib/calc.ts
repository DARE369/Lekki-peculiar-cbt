/**
 * A small, safe calculator for the exam screen: + − × ÷, brackets and decimal points.
 * It reads the typed text itself (never `eval`), follows the usual order of working (brackets first, then
 * × and ÷, then + and −), and gives a plain-English message instead of throwing.
 */

export type CalcResult = { ok: true; value: number; text: string } | { ok: false; error: string };

/** Characters the calculator accepts when typing. */
export const CALC_ALLOWED = /^[0-9.+\-−–*/×÷x()\s]*$/i;

/** Turns what was typed or pressed into the symbols used for working: × ÷ − all become * / -. */
export function normalise(input: string) {
  return input
    .replace(/[×x]/gi, "*")
    .replace(/÷/g, "/")
    .replace(/[−–]/g, "-")
    .replace(/\s+/g, "");
}

type Token = { t: "num"; v: number } | { t: "op"; v: "+" | "-" | "*" | "/" } | { t: "(" } | { t: ")" };

function tokenize(src: string): Token[] | string {
  const out: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if ((c >= "0" && c <= "9") || c === ".") {
      let j = i;
      let dots = 0;
      while (j < src.length && ((src[j] >= "0" && src[j] <= "9") || src[j] === ".")) {
        if (src[j] === ".") dots++;
        j++;
      }
      const raw = src.slice(i, j);
      if (dots > 1) return "A number has two decimal points";
      if (raw === ".") return "A decimal point needs a number";
      out.push({ t: "num", v: Number(raw) });
      i = j;
    } else if (c === "+" || c === "-" || c === "*" || c === "/") {
      out.push({ t: "op", v: c });
      i++;
    } else if (c === "(") {
      out.push({ t: "(" });
      i++;
    } else if (c === ")") {
      out.push({ t: ")" });
      i++;
    } else {
      return "Use only numbers, + − × ÷, brackets and a decimal point";
    }
  }
  return out;
}

/**
 * Recursive-descent parser:
 *   expr   = term (("+" | "-") term)*
 *   term   = factor (("*" | "/" | implicit-multiply) factor)*
 *   factor = ("+" | "-") factor | number | "(" expr ")"
 * Two things are allowed that students naturally write: a minus sign before a number or bracket (-3, 2×-3), and a
 * number or bracket straight before a bracket, meaning multiply (2(3+4) is 14).
 */
export function calculate(input: string): CalcResult {
  const src = normalise(input);
  if (!src) return { ok: false, error: "" };
  const tokens = tokenize(src);
  if (typeof tokens === "string") return { ok: false, error: tokens };

  let pos = 0;
  const peek = () => tokens[pos];
  class CalcError extends Error {}
  const fail = (m: string): never => {
    throw new CalcError(m);
  };

  const expr = (): number => {
    let left = term();
    for (;;) {
      const p = peek();
      if (p?.t === "op" && (p.v === "+" || p.v === "-")) {
        pos++;
        const right = term();
        left = p.v === "+" ? left + right : left - right;
      } else return left;
    }
  };
  const term = (): number => {
    let left = factor();
    for (;;) {
      const p = peek();
      if (p?.t === "op" && (p.v === "*" || p.v === "/")) {
        pos++;
        const right = factor();
        if (p.v === "/") {
          if (right === 0) fail("Can't divide by zero");
          left = left / right;
        } else left = left * right;
      } else if (p?.t === "(") {
        left = left * factor(); // 2(3+4)
      } else return left;
    }
  };
  const factor = (): number => {
    const p = peek();
    if (!p) return fail("The sum isn't finished");
    if (p.t === "op" && (p.v === "-" || p.v === "+")) {
      pos++;
      const v = factor();
      return p.v === "-" ? -v : v;
    }
    if (p.t === "num") {
      pos++;
      return p.v;
    }
    if (p.t === "(") {
      pos++;
      if (peek()?.t === ")") return fail("There is nothing inside the brackets");
      const v = expr();
      if (peek()?.t !== ")") return fail("A bracket isn't closed");
      pos++;
      return v;
    }
    return fail(p.t === ")" ? "There is a closing bracket with no opening one" : "A number is missing");
  };

  try {
    const value = expr();
    if (pos < tokens.length) return { ok: false, error: tokens[pos].t === ")" ? "There is a closing bracket with no opening one" : "Check the sum" };
    if (!Number.isFinite(value)) return { ok: false, error: "That number is too big" };
    // 0.1 + 0.2 should read 0.3, not 0.30000000000000004: keep 12 significant digits.
    const tidy = Number(value.toPrecision(12));
    return { ok: true, value: tidy, text: formatNumber(tidy) };
  } catch (e) {
    if (e instanceof CalcError) return { ok: false, error: e.message };
    return { ok: false, error: "Check the sum" };
  }
}

/** Plain digits, never scientific notation for ordinary sizes (so 0.00001 doesn't show as 1e-5). */
export function formatNumber(n: number): string {
  if (Object.is(n, -0)) return "0";
  const abs = Math.abs(n);
  if (abs !== 0 && (abs >= 1e15 || abs < 1e-9)) return n.toExponential(6).replace(/\.?0+e/, "e");
  const s = n.toFixed(12).replace(/\.?0+$/, "");
  return s === "" || s === "-" ? "0" : s;
}
