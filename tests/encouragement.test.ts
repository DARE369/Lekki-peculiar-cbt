import { describe, expect, it } from "vitest";
import { encouragementFor } from "@/lib/encouragement";

describe("encouragement after an exam", () => {
  it("is the same for the same student every time", () => {
    expect(encouragementFor("Ada:Maths Exam")).toBe(encouragementFor("Ada:Maths Exam"));
  });
  it("never talks about the score or marks", () => {
    for (const seed of ["a", "bb", "ccc", "Ada:Test", "Tolu:Exam", "x:y", "1", "22", "333"]) {
      expect(encouragementFor(seed)).not.toMatch(/\b(score|mark|marks|grade|pass|fail|percent|%)\b/i);
    }
  });
});
