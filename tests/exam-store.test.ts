import { describe, expect, it } from "vitest";
import { applySync, resendStamp, stampAt, type SyncDelta } from "@/components/exam/store";
import type { LocalAttempt } from "@/components/exam/types";

// A minute ago, so the tests do not depend on what day they run.
const T0 = Date.now() - 60_000;
const iso = (ms: number) => new Date(ms).toISOString();

function attempt(over: Partial<LocalAttempt> = {}): LocalAttempt {
  return {
    version: 1,
    token: "t",
    attemptId: "a",
    student: {} as LocalAttempt["student"],
    assessment: {} as LocalAttempt["assessment"],
    questions: [],
    deadline: iso(T0 + 30 * 60_000),
    offsetMs: 0,
    answers: {},
    dirty: [],
    events: [],
    current: 0,
    sealed: null,
    result: null,
    lastSyncAt: null,
    lastError: null,
    ...over,
  } as LocalAttempt;
}

describe("answer timestamps", () => {
  it("a newer answer is never stamped earlier than an older one, even when the clock estimate jumps back", () => {
    // The estimate of the server clock wobbles with the network: here it jumps back three seconds.
    const first = attempt({ offsetMs: 5000 });
    const at1 = stampAt(first);
    const second = attempt({ offsetMs: 2000, answers: { q1: { s: "A", f: false, at: at1 } } });
    expect(Date.parse(stampAt(second))).toBeGreaterThan(Date.parse(at1));
  });

  it("re-sent answers are stamped at or ahead of the server's clock, but inside the exam time", () => {
    const a = attempt();
    const now = Date.now();
    const at = Date.parse(resendStamp(a));
    expect(at).toBeGreaterThanOrEqual(now + 19_000);
    const nearEnd = attempt({ deadline: iso(Date.now() + 5_000) });
    expect(Date.parse(resendStamp(nearEnd))).toBeLessThanOrEqual(Date.parse(nearEnd.deadline) + 29_000);
  });
});

describe("answers the server did not take", () => {
  const sentAt = iso(T0);
  const base = () => attempt({ answers: { q1: { s: "B", f: false, at: sentAt } }, dirty: ["q1"] });
  const delta = (over: Partial<SyncDelta>): SyncDelta => ({ kind: "ok", sent: new Map([["q1", sentAt]]), eventsSent: 0, ...over });

  it("clears an answer once the server took it", () => {
    const next = applySync(base(), delta({}));
    expect(next.dirty).toEqual([]);
    expect(next.redoStreak).toBe(0);
  });

  it("keeps it waiting, with a fresh timestamp, when the server did not take it", () => {
    const next = applySync(base(), delta({ redo: true }));
    expect(next.dirty).toEqual(["q1"]);
    expect(Date.parse(next.answers.q1.at)).toBeGreaterThan(Date.parse(sentAt));
    expect(next.answers.q1.s).toBe("B");
    expect(next.redoStreak).toBe(1);
  });

  it("does not touch an answer the student changed while the request was in flight", () => {
    const changed = attempt({ answers: { q1: { s: "C", f: false, at: iso(T0 + 1) } }, dirty: ["q1"] });
    const next = applySync(changed, delta({ redo: true }));
    expect(next.answers.q1).toEqual({ s: "C", f: false, at: iso(T0 + 1) });
  });

  it("gives up after a few tries in a row, so a real refusal cannot loop forever", () => {
    const stuck = { ...base(), redoStreak: 3 };
    const next = applySync(stuck, delta({ redo: true }));
    expect(next.dirty).toEqual([]);
  });
});

describe("the final send", () => {
  it("re-stamps every answer, so none can look older than what the server holds", async () => {
    const { withFreshStamps } = await import("@/components/exam/store");
    const a = attempt({ answers: { q1: { s: "A", f: false, at: iso(T0) }, q2: { s: "B", f: true, at: iso(T0 + 5) } } });
    const out = withFreshStamps(a);
    for (const q of ["q1", "q2"]) expect(Date.parse(out.answers[q].at)).toBeGreaterThan(T0 + 10_000);
    expect(out.answers.q2).toMatchObject({ s: "B", f: true });
  });
});
