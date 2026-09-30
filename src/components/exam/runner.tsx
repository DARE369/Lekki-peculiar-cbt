"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Avatar, Button, cn } from "@/components/ui";
import { applySync, remainingMs, saveAttempt, serverNow, syncOnce } from "./store";
import type { LocalAttempt } from "./types";

const LETTERS = ["A", "B", "C", "D", "E", "F"];
const SYNC_EVERY_MS = 4000;
const HEARTBEAT_MS = 20_000;

function fmt(ms: number) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}

export function ExamRunner({
  initial,
  terminalToken,
  resumed,
  onFinish,
}: {
  initial: LocalAttempt;
  terminalToken: string;
  /** true when picked up from storage after a reload: needs a tap to re-enter full screen */
  resumed: boolean;
  onFinish: () => void;
}) {
  const [att, setAtt] = useState(initial);
  const latest = useRef(initial);
  const inFlight = useRef(false);
  const [online, setOnline] = useState(true);
  const [now, setNow] = useState(() => Date.now());
  const [reviewOpen, setReviewOpen] = useState(false);
  const [blocked, setBlocked] = useState<string | null>(null);
  const [needsGesture, setNeedsGesture] = useState(() => resumed && !initial.result && !initial.sealed);
  const [fullscreenLost, setFullscreenLost] = useState(false);

  const settings = att.assessment.settings;
  const allowBack = settings.allow_back !== false;
  const allowFlag = settings.allow_flag !== false && allowBack;

  /** Every change goes through here: state, ref and IndexedDB stay in step. */
  const update = useCallback((fn: (a: LocalAttempt) => LocalAttempt) => {
    const next = fn(latest.current);
    latest.current = next;
    setAtt(next);
    void saveAttempt(next);
  }, []);

  const logEvent = useCallback(
    (type: string, detail?: Record<string, unknown>) => {
      update((a) => (a.sealed || a.result ? a : { ...a, events: [...a.events, { type, at: new Date(serverNow(a)).toISOString(), detail }] }));
    },
    [update],
  );

  const runSync = useCallback(async () => {
    const a = latest.current;
    if (inFlight.current || a.result) return;
    const due =
      a.sealed || a.dirty.length > 0 || a.events.length > 0 || !a.lastSyncAt || Date.now() - Date.parse(a.lastSyncAt) > HEARTBEAT_MS;
    if (!due) return;
    inFlight.current = true;
    try {
      const delta = await syncOnce(a, terminalToken);
      setOnline(delta.kind !== "offline");
      if (delta.kind === "rejected") {
        if (delta.code === "unanswered") {
          update((x) => ({ ...x, sealed: null, lastError: delta.message ?? null }));
          setReviewOpen(true);
        } else if (delta.code === "expired" || delta.code === "attempt_not_found") {
          setBlocked(
            "This exam can't continue on this computer (it may have been moved to another computer by your supervisor). Please call your supervisor.",
          );
        } else {
          update((x) => applySync(x, delta));
        }
        return;
      }
      update((x) => applySync(x, delta));
    } finally {
      inFlight.current = false;
    }
  }, [terminalToken, update]);

  // Sync loop + reacting to the network coming back.
  useEffect(() => {
    const t = setInterval(runSync, SYNC_EVERY_MS);
    const onOnline = () => void runSync();
    window.addEventListener("online", onOnline);
    void runSync();
    return () => {
      clearInterval(t);
      window.removeEventListener("online", onOnline);
    };
  }, [runSync]);

  // Clock: auto-submit when time is up (works offline — the submission uploads later).
  useEffect(() => {
    const t = setInterval(() => {
      setNow(Date.now());
      const a = latest.current;
      if (!a.sealed && !a.result && remainingMs(a) <= 0) {
        update((x) => ({ ...x, sealed: { source: "timeout", at: new Date(serverNow(x)).toISOString() } }));
        setReviewOpen(false);
        void runSync();
      }
    }, 500);
    return () => clearInterval(t);
  }, [runSync, update]);

  // Integrity signals: leaving the tab/window, exiting full screen. Copy/paste/right-click blocked.
  useEffect(() => {
    if (att.result) return;
    const onVis = () => {
      if (document.visibilityState === "hidden") logEvent("focus_lost", { via: "tab" });
    };
    const onFs = () => {
      if (!document.fullscreenElement && !latest.current.result) {
        setFullscreenLost(true);
        logEvent("fullscreen_exit");
      }
    };
    const block = (e: Event) => e.preventDefault();
    document.addEventListener("visibilitychange", onVis);
    document.addEventListener("fullscreenchange", onFs);
    for (const ev of ["copy", "cut", "paste", "contextmenu"]) document.addEventListener(ev, block);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      document.removeEventListener("fullscreenchange", onFs);
      for (const ev of ["copy", "cut", "paste", "contextmenu"]) document.removeEventListener(ev, block);
    };
  }, [att.result, logEvent]);

  const q = att.questions[att.current];
  const answeredCount = useMemo(() => att.questions.filter((x) => att.answers[x.id]?.s).length, [att.questions, att.answers]);
  const unanswered = att.questions.map((x, i) => (att.answers[x.id]?.s ? -1 : i)).filter((i) => i >= 0);
  const flagged = att.questions.map((x, i) => (att.answers[x.id]?.f ? i : -1)).filter((i) => i >= 0);
  const remaining = remainingMs(att);
  void now;

  const choose = useCallback(
    (key: string) => {
      update((a) => {
        if (a.sealed || a.result) return a;
        const qid = a.questions[a.current].id;
        const prev = a.answers[qid];
        const s = prev?.s === key ? null : key; // tap again to clear
        return {
          ...a,
          answers: { ...a.answers, [qid]: { s, f: prev?.f ?? false, at: new Date(serverNow(a)).toISOString() } },
          dirty: a.dirty.includes(qid) ? a.dirty : [...a.dirty, qid],
        };
      });
    },
    [update],
  );

  const toggleFlag = useCallback(() => {
    update((a) => {
      if (a.sealed || a.result) return a;
      const qid = a.questions[a.current].id;
      const prev = a.answers[qid];
      return {
        ...a,
        answers: { ...a.answers, [qid]: { s: prev?.s ?? null, f: !prev?.f, at: new Date(serverNow(a)).toISOString() } },
        dirty: a.dirty.includes(qid) ? a.dirty : [...a.dirty, qid],
      };
    });
  }, [update]);

  const goTo = useCallback(
    (i: number) => {
      update((a) => {
        if (i < 0 || i >= a.questions.length) return a;
        if (!allowBack && i < a.current) return a;
        return { ...a, current: i };
      });
    },
    [update, allowBack],
  );

  const submit = useCallback(() => {
    update((a) => ({ ...a, sealed: { source: "student", at: new Date(serverNow(a)).toISOString() } }));
    setReviewOpen(false);
    void runSync();
  }, [update, runSync]);

  // Keyboard: letters answer, arrows move.
  const current = att.current;
  const sealed = Boolean(att.sealed);
  const finished = Boolean(att.result);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (reviewOpen || sealed || finished || needsGesture) return;
      if (e.target instanceof HTMLInputElement || e.ctrlKey || e.metaKey || e.altKey) return;
      const idx = LETTERS.indexOf(e.key.toUpperCase());
      if (idx >= 0 && q && idx < q.options.length) {
        e.preventDefault();
        choose(q.options[idx].key);
      } else if (e.key === "ArrowRight" || e.key.toLowerCase() === "n") {
        goTo(current + 1);
      } else if (e.key === "ArrowLeft" || e.key.toLowerCase() === "p") {
        goTo(current - 1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [q, current, sealed, finished, reviewOpen, needsGesture, choose, goTo]);

  // ------------------------------------------------------------------ screens
  if (blocked) {
    return (
      <Centered>
        <h1 className="text-2xl font-semibold">Please call your supervisor</h1>
        <p className="mt-3 text-muted">{blocked}</p>
        <Button className="mt-8" variant="secondary" onClick={onFinish}>
          Back to start
        </Button>
      </Centered>
    );
  }

  if (att.result) return <Finished att={att} onFinish={onFinish} />;

  if (att.sealed) {
    return (
      <Centered>
        <div className="mx-auto mb-6 h-12 w-12 animate-spin rounded-full border-4 border-brand-soft border-t-brand" />
        <h1 className="text-2xl font-semibold">{att.sealed.source === "timeout" ? "Time is up!" : "Submitting your exam…"}</h1>
        {online ? (
          <p className="mt-3 text-muted">Sending your answers to the school server.</p>
        ) : (
          <p className="mx-auto mt-3 max-w-md text-muted">
            Your exam is <strong>finished and saved on this computer</strong>. It will upload automatically when the internet comes
            back. <strong>Please don&apos;t switch off this computer.</strong>
          </p>
        )}
      </Centered>
    );
  }

  if (needsGesture) {
    return (
      <Centered>
        <Avatar src={att.student.photo_url} name={att.student.name} size={96} />
        <h1 className="mt-4 text-2xl font-semibold">{att.student.name}</h1>
        <p className="mt-1 text-muted">
          {att.assessment.subject} — {att.assessment.title}
        </p>
        <p className="mt-4 text-lg">
          Time left: <strong className="tabular-nums">{fmt(remaining)}</strong> · {answeredCount}/{att.questions.length} answered
        </p>
        <Button
          size="lg"
          className="mt-8 min-w-56 text-lg"
          onClick={async () => {
            try {
              await document.documentElement.requestFullscreen?.();
            } catch {}
            setNeedsGesture(false);
          }}
        >
          Continue exam
        </Button>
      </Centered>
    );
  }

  const answer = att.answers[q.id];
  const low = remaining < 5 * 60_000;
  const critical = remaining < 60_000;

  return (
    <div className="flex min-h-screen flex-col bg-bg select-none">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-surface px-4 py-3 sm:px-6">
        <div className="flex items-center gap-3">
          <Avatar src={att.student.photo_url} name={att.student.name} size={40} />
          <div className="leading-tight">
            <p className="font-semibold">{att.student.name}</p>
            <p className="text-xs text-muted">
              {att.assessment.subject} · {att.assessment.title}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span
            className={cn(
              "flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium",
              online && att.dirty.length === 0 ? "bg-success-soft text-success" : online ? "bg-info-soft text-info" : "bg-warning-soft text-warning",
            )}
            title={att.lastError ?? undefined}
          >
            <span className="h-2 w-2 rounded-full bg-current" />
            {!online ? "Offline — answers saved on this computer" : att.dirty.length ? "Saving…" : "All answers saved"}
          </span>
          <span
            className={cn(
              "rounded-xl px-4 py-2 font-mono text-2xl font-semibold tabular-nums",
              critical ? "animate-pulse bg-danger text-white" : low ? "bg-warning-soft text-warning" : "bg-surface-2",
            )}
            role="timer"
            aria-live={low ? "polite" : "off"}
          >
            {fmt(remaining)}
          </span>
        </div>
      </header>

      {fullscreenLost ? (
        <div className="flex items-center justify-between gap-3 bg-warning-soft px-6 py-2 text-sm text-warning">
          <span>You left full-screen mode. This has been recorded.</span>
          <button
            className="rounded border border-current px-3 py-1 font-medium"
            onClick={async () => {
              try {
                await document.documentElement.requestFullscreen?.();
              } catch {}
              setFullscreenLost(false);
            }}
          >
            Return to full screen
          </button>
        </div>
      ) : null}

      <div className="mx-auto grid w-full max-w-7xl flex-1 gap-6 p-4 sm:p-6 lg:grid-cols-[1fr_300px]">
        <main className="flex flex-col">
          <div className="flex-1 rounded-2xl border border-border bg-surface p-6 sm:p-8">
            <div className="mb-4 flex items-center justify-between gap-3">
              <p className="text-sm font-medium text-muted">
                Question {att.current + 1} of {att.questions.length}
              </p>
              {allowFlag ? (
                <button
                  onClick={toggleFlag}
                  className={cn(
                    "rounded-full border px-3 py-1 text-sm font-medium",
                    answer?.f ? "border-accent bg-accent text-black" : "border-border hover:border-accent",
                  )}
                  aria-pressed={answer?.f ?? false}
                >
                  ⚑ {answer?.f ? "Flagged for review" : "Flag for review"}
                </button>
              ) : null}
            </div>
            <p className="text-xl leading-relaxed whitespace-pre-wrap sm:text-2xl">{q.body}</p>
            {q.image_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={q.image_url} alt="Diagram for this question" className="mt-4 max-h-80 rounded-lg border border-border" />
            ) : null}
            <div className="mt-6 space-y-3" role="radiogroup" aria-label={`Options for question ${att.current + 1}`}>
              {q.options.map((o, i) => {
                const selected = answer?.s === o.key;
                return (
                  <button
                    key={o.key}
                    role="radio"
                    aria-checked={selected}
                    onClick={() => choose(o.key)}
                    className={cn(
                      "flex w-full items-start gap-4 rounded-xl border-2 p-4 text-left text-lg transition",
                      selected ? "border-brand bg-brand-soft" : "border-border hover:border-brand/60",
                    )}
                  >
                    <span
                      className={cn(
                        "flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 font-semibold",
                        selected ? "border-brand bg-brand text-white dark:text-bg" : "border-border",
                      )}
                    >
                      {LETTERS[i]}
                    </span>
                    <span className="pt-1">{o.text}</span>
                  </button>
                );
              })}
            </div>
          </div>
          <div className="mt-4 flex items-center justify-between gap-3">
            <Button variant="secondary" size="lg" onClick={() => goTo(att.current - 1)} disabled={att.current === 0 || !allowBack}>
              ← Previous
            </Button>
            {att.current < att.questions.length - 1 ? (
              <Button size="lg" onClick={() => goTo(att.current + 1)}>
                Next →
              </Button>
            ) : (
              <Button size="lg" onClick={() => setReviewOpen(true)}>
                Finish &amp; submit
              </Button>
            )}
          </div>
          <p className="mt-3 text-center text-xs text-muted">Tip: press A, B, C or D to answer, and the arrow keys to move.</p>
        </main>

        <aside className="space-y-4">
          <div className="rounded-2xl border border-border bg-surface p-4">
            <p className="mb-3 text-sm font-medium">
              {answeredCount} of {att.questions.length} answered
            </p>
            <div className="grid grid-cols-5 gap-2">
              {att.questions.map((x, i) => {
                const a = att.answers[x.id];
                return (
                  <button
                    key={x.id}
                    onClick={() => goTo(i)}
                    disabled={!allowBack && i < att.current}
                    aria-label={`Question ${i + 1}${a?.s ? ", answered" : ""}${a?.f ? ", flagged" : ""}`}
                    className={cn(
                      "relative h-10 rounded-lg border text-sm font-medium tabular-nums disabled:opacity-40",
                      a?.s ? "border-brand bg-brand text-white dark:text-bg" : "border-border bg-surface-2",
                      i === att.current && "ring-2 ring-accent ring-offset-2 ring-offset-surface",
                    )}
                  >
                    {i + 1}
                    {a?.f ? <span className="absolute -top-1 -right-1 h-3 w-3 rounded-full bg-accent" /> : null}
                  </button>
                );
              })}
            </div>
            <div className="mt-4 space-y-1 text-xs text-muted">
              <p className="flex items-center gap-2">
                <span className="h-3 w-3 rounded bg-brand" /> Answered
              </p>
              <p className="flex items-center gap-2">
                <span className="h-3 w-3 rounded border border-border bg-surface-2" /> Not answered
              </p>
              {allowFlag ? (
                <p className="flex items-center gap-2">
                  <span className="h-3 w-3 rounded-full bg-accent" /> Flagged for review
                </p>
              ) : null}
            </div>
          </div>
          <Button variant="secondary" size="lg" className="w-full" onClick={() => setReviewOpen(true)}>
            Review &amp; submit
          </Button>
        </aside>
      </div>

      {reviewOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-lg rounded-2xl bg-surface p-6 shadow-xl">
            <h2 className="text-xl font-semibold">Ready to submit?</h2>
            <p className="mt-2 text-muted">
              You have answered <strong>{answeredCount}</strong> of {att.questions.length} questions. Time left: {fmt(remaining)}.
            </p>
            {unanswered.length ? (
              <div className="mt-4">
                <p className="text-sm font-medium">Not answered:</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {unanswered.map((i) => (
                    <button
                      key={i}
                      className="h-9 min-w-9 rounded-lg border border-border px-2 text-sm hover:border-brand disabled:opacity-40"
                      disabled={!allowBack && i < att.current}
                      onClick={() => {
                        goTo(i);
                        setReviewOpen(false);
                      }}
                    >
                      {i + 1}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            {flagged.length ? (
              <div className="mt-4">
                <p className="text-sm font-medium">Flagged for review:</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {flagged.map((i) => (
                    <button
                      key={i}
                      className="h-9 min-w-9 rounded-lg border border-accent px-2 text-sm"
                      onClick={() => {
                        goTo(i);
                        setReviewOpen(false);
                      }}
                    >
                      {i + 1}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            {settings.require_all_answered && unanswered.length ? (
              <p className="mt-4 rounded-lg bg-warning-soft p-3 text-sm text-warning">
                You must answer every question before you can submit. (If time runs out, your exam is submitted automatically.)
              </p>
            ) : null}
            {att.lastError && !online ? null : att.lastError ? <p className="mt-3 text-sm text-danger">{att.lastError}</p> : null}
            <div className="mt-6 flex flex-wrap justify-end gap-3">
              <Button variant="secondary" size="lg" onClick={() => setReviewOpen(false)}>
                Keep working
              </Button>
              <Button size="lg" disabled={Boolean(settings.require_all_answered && unanswered.length)} onClick={submit}>
                Submit now
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="flex max-w-xl flex-col items-center text-center">{children}</div>
    </div>
  );
}

function Finished({ att, onFinish }: { att: LocalAttempt; onFinish: () => void }) {
  const r = att.result!;
  const [countdown, setCountdown] = useState(r.show === "full" ? 300 : 45);
  useEffect(() => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    const t = setInterval(() => setCountdown((c) => c - 1), 1000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (countdown <= 0) onFinish();
  }, [countdown, onFinish]);

  const pct = r.max_score ? Math.round((Number(r.score) / Number(r.max_score)) * 100) : null;
  const byId = new Map(att.questions.map((q) => [q.id, q]));
  return (
    <div className="mx-auto max-w-3xl px-4 py-12">
      <div className="text-center">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-success-soft text-3xl text-success">✓</div>
        <h1 className="mt-4 text-3xl font-semibold">{r.status === "voided" ? "This attempt was cancelled" : "Exam submitted"}</h1>
        <p className="mt-2 text-muted">
          Well done, {att.student.first_name}. {att.assessment.subject} — {att.assessment.title}
        </p>
        {r.show !== "none" && r.score != null ? (
          <div className="mt-8 inline-flex flex-col items-center rounded-2xl border border-border bg-surface px-10 py-6">
            <p className="text-sm text-muted">Your score</p>
            <p className="text-5xl font-semibold tabular-nums">
              {Number(r.score)} <span className="text-2xl text-muted">/ {Number(r.max_score)}</span>
            </p>
            {pct != null ? <p className="mt-1 text-lg">{pct}%</p> : null}
          </div>
        ) : r.status === "submitted" ? (
          <p className="mt-6 text-lg">Your teacher will share your results.</p>
        ) : null}
      </div>
      {r.show === "full" && r.review ? (
        <div className="mt-10 space-y-3">
          <h2 className="text-lg font-semibold">Corrections</h2>
          {r.review.map((row, i) => {
            const q = byId.get(row.q);
            if (!q) return null;
            const correct = row.s === row.a;
            const label = (key: string | null) => {
              const idx = q.options.findIndex((o) => o.key === key);
              return idx >= 0 ? `${LETTERS[idx]}. ${q.options[idx].text}` : "No answer";
            };
            return (
              <div key={row.q} className={cn("rounded-xl border p-4", correct ? "border-success/40" : "border-danger/40")}>
                <p className="font-medium">
                  {i + 1}. {q.body}
                </p>
                <p className={cn("mt-2 text-sm", correct ? "text-success" : "text-danger")}>Your answer: {label(row.s)}</p>
                {!correct ? <p className="text-sm text-success">Correct answer: {label(row.a)}</p> : null}
              </div>
            );
          })}
        </div>
      ) : null}
      <div className="mt-10 text-center">
        <Button size="lg" className="min-w-56 text-lg" onClick={onFinish}>
          Finish — next student
        </Button>
        <p className="mt-2 text-xs text-muted">This screen closes by itself in {countdown}s.</p>
      </div>
    </div>
  );
}
