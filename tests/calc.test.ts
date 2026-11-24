import { describe, expect, it } from "vitest";
import { calculate, formatNumber, normalise } from "@/lib/calc";

const val = (s: string) => {
  const r = calculate(s);
  if (!r.ok) throw new Error(`"${s}" failed: ${r.error}`);
  return r.text;
};
const err = (s: string) => {
  const r = calculate(s);
  if (r.ok) throw new Error(`"${s}" should have failed but gave ${r.text}`);
  return r.error;
};

describe("calculator: the four operations", () => {
  it("adds, subtracts, multiplies and divides", () => {
    expect(val("2+3")).toBe("5");
    expect(val("10-4")).toBe("6");
    expect(val("6*7")).toBe("42");
    expect(val("20/4")).toBe("5");
  });
  it("accepts the symbols shown on the buttons", () => {
    expect(val("6×7")).toBe("42");
    expect(val("20÷4")).toBe("5");
    expect(val("10−4")).toBe("6");
    expect(val("6x7")).toBe("42");
  });
  it("ignores spaces", () => {
    expect(val(" 12 + 8 ")).toBe("20");
  });
});

describe("calculator: order of working and brackets", () => {
  it("does × and ÷ before + and −", () => {
    expect(val("2+3*4")).toBe("14");
    expect(val("10-6/2")).toBe("7");
    expect(val("2*3+4*5")).toBe("26");
  });
  it("works left to right at the same level", () => {
    expect(val("10-3-2")).toBe("5");
    expect(val("100/10/5")).toBe("2");
    expect(val("8/4*2")).toBe("4");
  });
  it("does brackets first", () => {
    expect(val("(2+3)*4")).toBe("20");
    expect(val("2*(3+4)")).toBe("14");
    expect(val("(10-4)/(1+2)")).toBe("2");
  });
  it("handles brackets inside brackets", () => {
    expect(val("2*((3+4)*(5-1))")).toBe("56");
    expect(val("((((7))))")).toBe("7");
  });
  it("treats a number straight before a bracket as multiply", () => {
    expect(val("2(3+4)")).toBe("14");
    expect(val("(1+1)(2+2)")).toBe("8");
  });
});

describe("calculator: decimals", () => {
  it("handles decimal points", () => {
    expect(val("1.5+2.25")).toBe("3.75");
    expect(val("0.5*0.5")).toBe("0.25");
    expect(val(".5+.5")).toBe("1");
    expect(val("5.")).toBe("5");
  });
  it("does not show floating point noise", () => {
    expect(val("0.1+0.2")).toBe("0.3");
    expect(val("0.7*3")).toBe("2.1");
    expect(val("1.1*1.1")).toBe("1.21");
    expect(val("10/3")).toBe("3.33333333333"); // 12 significant digits
  });
  it("does not use scientific notation for ordinary numbers", () => {
    expect(val("0.00001*1")).toBe("0.00001");
    expect(val("1000000*1000000")).toBe("1000000000000");
  });
});

describe("calculator: negatives", () => {
  it("allows a minus in front of a number or bracket", () => {
    expect(val("-3+5")).toBe("2");
    expect(val("2*-3")).toBe("-6");
    expect(val("-(2+3)")).toBe("-5");
    expect(val("5--2")).toBe("7");
    expect(val("3-(-2)")).toBe("5");
  });
  it("never shows negative zero", () => {
    expect(val("0*-5")).toBe("0");
    expect(formatNumber(-0)).toBe("0");
  });
});

describe("calculator: mistakes give a plain message, never a crash", () => {
  it("says it can't divide by zero", () => {
    expect(err("5/0")).toMatch(/divide by zero/i);
    expect(err("1/(2-2)")).toMatch(/divide by zero/i);
  });
  it("spots brackets that don't match", () => {
    expect(err("(2+3")).toMatch(/bracket/i);
    expect(err("2+3)")).toMatch(/bracket/i);
    expect(err("()")).toMatch(/nothing inside/i);
  });
  it("spots unfinished or malformed sums", () => {
    expect(err("2+")).toMatch(/finished/i);
    expect(err("*3")).toMatch(/missing/i);
    expect(err("2**3")).toMatch(/missing/i);
    expect(err("1.2.3+1")).toMatch(/two decimal points/i);
    expect(err(".")).toMatch(/decimal point/i);
  });
  it("refuses anything that isn't a sum, so nothing can be run", () => {
    expect(err("alert(1)")).toMatch(/only numbers/i);
    expect(err("2+3; 4")).toMatch(/only numbers/i);
    expect(err("constructor")).toMatch(/only numbers/i);
    expect(err("1e5")).toMatch(/only numbers/i);
  });
  it("says nothing for an empty sum", () => {
    expect(calculate("")).toEqual({ ok: false, error: "" });
    expect(calculate("   ")).toEqual({ ok: false, error: "" });
  });
  it("copes with huge numbers", () => {
    expect(err("1" + "0".repeat(400) + "*10")).toMatch(/too big/i);
  });
});

describe("calculator: typed symbols are tidied", () => {
  it("turns the button symbols into working symbols", () => {
    expect(normalise("6×7 ÷ 2 − 1")).toBe("6*7/2-1");
  });
});
