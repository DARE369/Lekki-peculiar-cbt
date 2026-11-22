import { describe, expect, it } from "vitest";
import { canStillResume, resumeCutoffIso, RESUME_GRACE_HOURS } from "@/lib/resume";

describe("letting students continue", () => {
  const now = Date.parse("2026-11-22T12:00:00Z");
  it("is allowed while the exam is open and for a day after it closes", () => {
    expect(canStillResume({ ends_at: "2026-11-22T14:00:00Z" }, now)).toBe(true);
    expect(canStillResume({ ends_at: "2026-11-21T13:00:00Z" }, now)).toBe(true);
  });
  it("is not allowed once the exam has been closed for a day", () => {
    expect(canStillResume({ ends_at: "2026-11-21T11:00:00Z" }, now)).toBe(false);
    expect(canStillResume({ ends_at: "2026-09-20T13:00:00Z" }, now)).toBe(false);
  });
  it("uses the same cutoff for counts and badges", () => {
    expect(resumeCutoffIso(now)).toBe(new Date(now - RESUME_GRACE_HOURS * 3600_000).toISOString());
  });
});
