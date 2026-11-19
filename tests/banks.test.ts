import { describe, expect, it } from "vitest";
import { defaultBankName, groupByUpload } from "@/lib/banks";

describe("groupByUpload", () => {
  const at = (iso: string, id: string, round: string | null = null) => ({ id, created_at: iso, round_id: round });
  it("splits older questions back into the uploads they came from", () => {
    const rows = [
      at("2026-10-12T09:40:00.000Z", "a1", "ca1"),
      at("2026-10-12T09:40:01.200Z", "a2", "ca1"),
      at("2026-10-12T09:40:02.900Z", "a3", "ca1"),
      // same day, afternoon: a different upload (the morning and afternoon stay apart)
      at("2026-10-12T14:05:00.000Z", "b1", "exam"),
      at("2026-10-12T14:05:00.500Z", "b2", null),
    ];
    const g = groupByUpload(rows);
    expect(g).toHaveLength(2);
    expect(g[0].ids).toEqual(["b1", "b2"]); // newest first
    expect(g[0].roundId).toBeNull(); // mixed rounds → no single round
    expect(g[1].ids).toEqual(["a1", "a2", "a3"]);
    expect(g[1].roundId).toBe("ca1");
  });
  it("keeps one long upload together when questions arrive seconds apart", () => {
    const rows = Array.from({ length: 50 }, (_, i) => at(new Date(Date.UTC(2026, 9, 1, 8, 0, i * 2)).toISOString(), `q${i}`));
    expect(groupByUpload(rows)).toHaveLength(1);
  });
});

describe("defaultBankName", () => {
  it("is Subject · Round · date", () => {
    expect(defaultBankName("Mathematics", "1st CA", "2026-10-12T09:40:00Z")).toBe("Mathematics · 1st CA · 12 Oct 2026");
    expect(defaultBankName("Mathematics", null, "2026-10-12T09:40:00Z")).toBe("Mathematics · Any round · 12 Oct 2026");
  });
});
