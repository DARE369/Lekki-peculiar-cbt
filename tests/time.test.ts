import { describe, expect, it } from "vitest";
import { isoToLagosLocal, lagosLocalToIso } from "@/lib/time";

describe("Lagos time helpers", () => {
  it("round-trips", () => {
    const iso = lagosLocalToIso("2026-10-05T09:30");
    expect(iso).toBe("2026-10-05T08:30:00.000Z");
    expect(isoToLagosLocal(iso!)).toBe("2026-10-05T09:30");
  });
  it("rejects junk", () => {
    expect(lagosLocalToIso("")).toBeNull();
    expect(lagosLocalToIso("tomorrow")).toBeNull();
  });
});
