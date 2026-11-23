// Everything the exam needs lives in IndexedDB on the lab computer, so a refresh, a crash or
// a dead network never loses answers. The server is updated whenever it can be reached.
import { del, get, set } from "idb-keyval";
import type { LocalAttempt } from "./types";

const TERMINAL_KEY = "cbt.terminal";
const ATTEMPT_KEY = "cbt.attempt";

export interface TerminalIdentity {
  token: string;
  name: string;
}

export function loadTerminal(): TerminalIdentity | null {
  try {
    const raw = localStorage.getItem(TERMINAL_KEY);
    return raw ? (JSON.parse(raw) as TerminalIdentity) : null;
  } catch {
    return null;
  }
}
export function saveTerminal(t: TerminalIdentity) {
  localStorage.setItem(TERMINAL_KEY, JSON.stringify(t));
}
export function forgetTerminal() {
  localStorage.removeItem(TERMINAL_KEY);
}

export async function loadAttempt(): Promise<LocalAttempt | null> {
  try {
    return ((await get(ATTEMPT_KEY)) as LocalAttempt | undefined) ?? null;
  } catch {
    return null;
  }
}
export async function saveAttempt(a: LocalAttempt) {
  await set(ATTEMPT_KEY, a);
}
export async function clearAttempt() {
  await del(ATTEMPT_KEY);
}

/** Server time estimate (server clock is the authority for the deadline). */
export function serverNow(a: Pick<LocalAttempt, "offsetMs">) {
  return Date.now() + a.offsetMs;
}
export function remainingMs(a: Pick<LocalAttempt, "offsetMs" | "deadline">) {
  return Date.parse(a.deadline) - serverNow(a);
}

function latestAnswerAt(a: Pick<LocalAttempt, "answers">) {
  let last = 0;
  for (const v of Object.values(a.answers)) last = Math.max(last, Date.parse(v.at) || 0);
  return last;
}

/**
 * The timestamp for a new answer. The server keeps the newest answer per question, judged by this time, and our
 * estimate of the server's clock wobbles with the network. So each new answer is stamped strictly later than every
 * earlier one: a change of mind can never look older than the answer it replaces.
 */
export function stampAt(a: Pick<LocalAttempt, "offsetMs" | "answers">): string {
  return new Date(Math.max(serverNow(a), latestAnswerAt(a) + 1)).toISOString();
}

/**
 * A timestamp for re-sending answers the server did not take. The server stores the earlier of this and its own
 * clock, so stamping a little ahead of our estimate guarantees the re-sent answer is never older than what the
 * server already holds, whatever the clock wobble. Kept inside the exam time (the server drops answers stamped
 * long after the deadline).
 */
export function resendStamp(a: Pick<LocalAttempt, "offsetMs" | "answers" | "deadline">): string {
  const est = serverNow(a);
  const wanted = Math.max(est + 20_000, latestAnswerAt(a) + 1);
  return new Date(Math.max(est, Math.min(wanted, Date.parse(a.deadline) + 29_000))).toISOString();
}

export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
    public body?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, terminalToken: string, body: unknown, bearer?: string): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch(`/api/exam/${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-terminal-token": terminalToken,
        ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
      },
      body: JSON.stringify(body ?? {}),
      signal: controller.signal,
      cache: "no-store",
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(json.error ?? "http", json.message ?? `Error ${res.status}`, res.status, json);
    return json as T;
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError("offline", "No connection to the server.", 0);
  } finally {
    clearTimeout(timer);
  }
}

/** Every answer re-stamped for a final send, so the server cannot keep an older-looking copy of any of them. */
export function withFreshStamps<T extends Pick<LocalAttempt, "offsetMs" | "answers" | "deadline">>(a: T): T {
  const stamp = resendStamp(a);
  return { ...a, answers: Object.fromEntries(Object.entries(a.answers).map(([q, v]) => [q, { ...v, at: stamp }])) };
}

export interface SyncDelta {
  kind: "ok" | "offline" | "finished" | "rejected";
  code?: string;
  message?: string;
  offsetMs?: number;
  deadline?: string;
  /** answers sent, with the timestamp that was sent — cleared from dirty only if unchanged since */
  sent: Map<string, string>;
  eventsSent: number;
  result?: LocalAttempt["result"];
  /** the server said it did not take some of the answers we sent: send them again */
  redo?: boolean;
}

/** Push pending answers (or the final submission) to the server once. */
export async function syncOnce(att: LocalAttempt, terminalToken: string): Promise<SyncDelta> {
  const answers = att.sealed
    ? Object.entries(att.answers).map(([q, v]) => ({ q, s: v.s, f: v.f, at: v.at }))
    : att.dirty.filter((q) => att.answers[q]).map((q) => ({ q, ...att.answers[q] }));
  const sent = new Map(answers.map((x) => [x.q, x.at]));
  const eventsSent = att.events.length;
  try {
    type Resp = { status: string; deadline?: string; server_now: string } & Record<string, unknown>;
    const res = await api<Resp>(
      att.sealed ? "submit" : "sync",
      terminalToken,
      { answers, events: att.events, source: att.sealed?.source },
      att.token,
    );
    const base = { sent, eventsSent, offsetMs: Date.parse(res.server_now) - Date.now(), deadline: res.deadline };
    if (att.sealed) return { ...base, kind: "finished", result: res as unknown as LocalAttempt["result"] };
    if (res.status === "submitted" || res.status === "voided") {
      return { ...base, kind: "finished", result: { status: res.status, show: "none" } };
    }
    // The server says how many answers it actually took. If it took fewer than we sent, they are not saved.
    const rejected = typeof res.rejected === "number" ? res.rejected : 0;
    return { ...base, kind: "ok", redo: rejected > 0 };
  } catch (e) {
    const err = e as ApiError;
    const kind = err.code === "offline" || err.status >= 500 ? "offline" : "rejected";
    return { kind, code: err.code, message: err.message, sent: new Map(), eventsSent: 0 };
  }
}

/** Merge a sync result into the latest local state (answers may have changed meanwhile). */
export function applySync(latest: LocalAttempt, d: SyncDelta): LocalAttempt {
  if (d.kind === "offline" || d.kind === "rejected") return { ...latest, lastError: d.message ?? null };
  // Some answers were not taken by the server: keep them waiting and re-send with a fresh timestamp.
  // (Gives up after a few tries in a row, so a genuine refusal can't loop forever.)
  if (d.redo && (latest.redoStreak ?? 0) < 3) {
    const stamp = resendStamp(latest);
    const answers = { ...latest.answers };
    for (const [q, at] of d.sent) if (answers[q] && answers[q].at === at) answers[q] = { ...answers[q], at: stamp };
    return {
      ...latest,
      answers,
      offsetMs: d.offsetMs ?? latest.offsetMs,
      deadline: d.deadline ?? latest.deadline,
      events: latest.events.slice(d.eventsSent),
      redoStreak: (latest.redoStreak ?? 0) + 1,
      lastSyncAt: new Date().toISOString(),
      lastError: null,
    };
  }
  return {
    ...latest,
    offsetMs: d.offsetMs ?? latest.offsetMs,
    deadline: d.deadline ?? latest.deadline,
    dirty: latest.dirty.filter((q) => !d.sent.has(q) || latest.answers[q]?.at !== d.sent.get(q)),
    events: latest.events.slice(d.eventsSent),
    redoStreak: 0,
    lastSyncAt: new Date().toISOString(),
    lastError: null,
    result: d.kind === "finished" ? (d.result ?? { status: "submitted", show: "none" }) : latest.result,
  };
}
