import { describe, expect, it } from "vitest";
import { applySync, remainingMs, type SyncDelta } from "@/components/exam/store";
import type { LocalAttempt } from "@/components/exam/types";

function attempt(): LocalAttempt {
  return {
    version: 1,
    token: "t",
    attemptId: "a",
    student: { id: "s", name: "Charles", first_name: "Charles", class_name: "Y4", photo_url: null },
    assessment: { title: "T", type: "test", subject: "Bio", duration_minutes: 20, question_count: 2, settings: {} },
    questions: [],
    deadline: new Date(Date.now() + 60_000).toISOString(),
    offsetMs: 0,
    answers: { q1: { s: "A", f: false, at: "2026-01-01T00:00:01Z" }, q2: { s: "B", f: false, at: "2026-01-01T00:00:02Z" } },
    dirty: ["q1", "q2"],
    events: [{ type: "focus_lost", at: "x" }],
    current: 0,
    sealed: null,
    result: null,
    lastSyncAt: null,
    lastError: null,
  };
}

describe("applySync", () => {
  it("clears only answers that did not change while the request was in flight", () => {
    const before = attempt();
    const delta: SyncDelta = {
      kind: "ok",
      sent: new Map([
        ["q1", "2026-01-01T00:00:01Z"],
        ["q2", "2026-01-01T00:00:02Z"],
      ]),
      eventsSent: 1,
      offsetMs: 500,
    };
    // Student changed q2 meanwhile and triggered a new event.
    const latest = attempt();
    latest.answers.q2 = { s: "C", f: false, at: "2026-01-01T00:00:09Z" };
    latest.events.push({ type: "fullscreen_exit", at: "y" });
    const merged = applySync(latest, delta);
    expect(merged.dirty).toEqual(["q2"]);
    expect(merged.answers.q2.s).toBe("C");
    expect(merged.events).toEqual([{ type: "fullscreen_exit", at: "y" }]);
    expect(merged.offsetMs).toBe(500);
    expect(before.dirty).toHaveLength(2);
  });

  it("keeps everything when offline", () => {
    const merged = applySync(attempt(), { kind: "offline", message: "No connection", sent: new Map(), eventsSent: 0 });
    expect(merged.dirty).toHaveLength(2);
    expect(merged.lastError).toBe("No connection");
  });

  it("records the result when finished", () => {
    const merged = applySync(attempt(), {
      kind: "finished",
      sent: new Map(),
      eventsSent: 0,
      result: { status: "submitted", show: "score", score: 1, max_score: 2 },
    });
    expect(merged.result?.score).toBe(1);
  });
});

describe("remainingMs", () => {
  it("uses the server clock offset", () => {
    const a = { deadline: new Date(Date.now() + 60_000).toISOString(), offsetMs: 30_000 };
    expect(Math.round(remainingMs(a) / 1000)).toBe(30);
  });
});
