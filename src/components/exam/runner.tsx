"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Check,
  ClipboardCheck,
  Cloud,
  CloudCheck,
  CloudOff,
  Flag,
  Hand,
  ListChecks,
  PartyPopper,
  PlayCircle,
  Timer,
} from "lucide-react";
import { Crest } from "@/components/brand";
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
        <span className="inline-flex size-16 items-center justify-center rounded-3xl bg-warning-soft text-warning">
          <Hand className="size-8" aria-hidden />
        </span>
        <h1 className="mt-5 text-3xl font-bold tracking-tight">Please call your supervisor</h1>
        <p className="mt-3 text-lg text-muted">{blocked}</p>
        <Button className="mt-8" size="lg" variant="secondary" onClick={onFinish}>
          Back to start
        </Button>
      </Centered>
    );
  }

  if (att.result) return <Finished att={att} onFinish={onFinish} />;

  if (att.sealed) {
    return (
      <Centered>
        {online ? (
          <span className="size-16 animate-spin rounded-full border-[6px] border-brand-soft border-t-brand" aria-hidden />
        ) : (
          <span className="inline-flex size-16 items-center justify-center rounded-3xl bg-warning-soft text-warning">
            <CloudOff className="size-8" aria-hidden />
          </span>
        )}
        <h1 className="mt-6 text-3xl font-bold tracking-tight">{att.sealed.source === "timeout" ? "Time is up!" : "Submitting your exam…"}</h1>
        {online ? (
          <p className="mt-3 text-lg text-muted">Sending your answers to the school server.</p>
        ) : (
          <p className="mx-auto mt-3 max-w-md text-lg text-muted">
            Your exam is <strong className="text-text">finished and saved on this computer</strong>. It will upload automatically when the
            internet comes back. <strong className="text-text">Please don&apos;t switch off this computer.</strong>
          </p>
        )}
      </Centered>
    );
  }

  if (needsGesture) {
    return (
      <Centered>
        <Avatar src={att.student.photo_url} name={att.student.name} size={112} />
        <h1 className="mt-5 text-3xl font-bold tracking-tight">{att.student.name}</h1>
        <p className="mt-1 text-lg text-muted">
          {att.assessment.subject} — {att.assessment.title}
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <span className="inline-flex items-center gap-2 rounded-full bg-surface-2 px-4 py-2 font-semibold">
            <Timer className="size-4 text-brand" aria-hidden /> Time left: <span className="tabular-nums">{fmt(remaining)}</span>
          </span>
          <span className="inline-flex items-center gap-2 rounded-full bg-surface-2 px-4 py-2 font-semibold">
            <ListChecks className="size-4 text-brand" aria-hidden /> {answeredCount}/{att.questions.length} answered
          </span>
        </div>
        <Button
          size="lg"
          className="mt-8 h-14 min-w-60 text-lg"
          onClick={async () => {
            try {
              await document.documentElement.requestFullscreen?.();
            } catch {}
            setNeedsGesture(false);
          }}
        >
          <PlayCircle className="!size-5" /> Continue exam
        </Button>
      </Centered>
    );
  }

  const answer = att.answers[q.id];
  const low = remaining < 5 * 60_000;
  const critical = remaining < 60_000;
  const total = Math.max(1, att.questions.length);
  const durationMs = att.assessment.duration_minutes * 60_000;
  const timeFraction = Math.max(0, Math.min(1, remaining / Math.max(durationMs, remaining)));
  const saved = online && att.dirty.length === 0;

  return (
    <div className="flex min-h-screen flex-col bg-bg select-none">
      <header className="sticky top-0 z-20 border-b border-border bg-surface/95 backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <Crest size={36} className="hidden sm:block" />
            <Avatar src={att.student.photo_url} name={att.student.name} size={40} />
            <div className="min-w-0 leading-tight">
              <p className="truncate font-bold">{att.student.name}</p>
              <p className="truncate text-xs text-muted">
                {att.assessment.subject} · {att.assessment.title}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 sm:gap-3">
            <span
              className={cn(
                "hidden items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold sm:inline-flex",
                saved ? "bg-success-soft text-success" : online ? "bg-info-soft text-info" : "bg-warning-soft text-warning",
              )}
              title={att.lastError ?? undefined}
            >
              {saved ? <CloudCheck className="size-4" aria-hidden /> : online ? <Cloud className="size-4 animate-pulse" aria-hidden /> : <CloudOff className="size-4" aria-hidden />}
              {!online ? "Offline — answers saved on this computer" : att.dirty.length ? "Saving…" : "All answers saved"}
            </span>
            <span
              className={cn(
                "inline-flex items-center gap-2 rounded-2xl px-4 py-2 font-mono text-2xl font-bold tabular-nums",
                critical ? "animate-pulse bg-danger text-white dark:text-bg" : low ? "bg-warning-soft text-warning" : "bg-brand-soft text-brand",
              )}
              role="timer"
              aria-live={low ? "polite" : "off"}
            >
              <Timer className="size-5" aria-hidden />
              {fmt(remaining)}
            </span>
          </div>
        </div>
        <div className="h-1.5 w-full bg-surface-2" aria-hidden>
          <div
            className={cn("h-full transition-[width] duration-500", critical ? "bg-danger" : low ? "bg-warning" : "bg-brand")}
            style={{ width: `${timeFraction * 100}%` }}
          />
        </div>
      </header>

      {fullscreenLost ? (
        <div className="flex flex-wrap items-center justify-between gap-3 bg-warning-soft px-6 py-2.5 text-sm font-medium text-warning">
          <span className="inline-flex items-center gap-2">
            <AlertTriangle className="size-4" aria-hidden /> You left full-screen mode. This has been recorded.
          </span>
          <button
            className="rounded-lg border border-current px-3 py-1 font-semibold"
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

      <div className="mx-auto grid w-full max-w-7xl flex-1 gap-6 p-4 sm:p-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <main className="flex flex-col">
          <div className="flex-1 rounded-[28px] border border-border bg-surface p-6 shadow-card sm:p-9">
            <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
              <p className="inline-flex items-center gap-2 rounded-full bg-brand-soft px-3.5 py-1.5 text-sm font-bold text-brand">
                Question {att.current + 1} of {att.questions.length}
              </p>
              {allowFlag ? (
                <button
                  onClick={toggleFlag}
                  className={cn(
                    "inline-flex items-center gap-2 rounded-full border-2 px-3.5 py-1.5 text-sm font-semibold transition-colors",
                    answer?.f ? "border-accent bg-accent text-accent-ink" : "border-border text-muted hover:border-accent hover:text-text",
                  )}
                  aria-pressed={answer?.f ?? false}
                >
                  <Flag className="size-4" aria-hidden /> {answer?.f ? "Flagged for review" : "Flag for review"}
                </button>
              ) : null}
            </div>
            <p className="text-xl leading-relaxed font-semibold whitespace-pre-wrap sm:text-2xl sm:leading-relaxed">{q.body}</p>
            {q.image_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={q.image_url} alt="Diagram for this question" className="mt-5 max-h-80 rounded-2xl border border-border bg-white p-2" />
            ) : null}
            <div className="mt-8 grid gap-3" role="radiogroup" aria-label={`Options for question ${att.current + 1}`}>
              {q.options.map((o, i) => {
                const selected = answer?.s === o.key;
                return (
                  <button
                    key={o.key}
                    role="radio"
                    aria-checked={selected}
                    onClick={() => choose(o.key)}
                    className={cn(
                      "group flex w-full items-center gap-4 rounded-2xl border-2 p-4 text-left text-lg transition-all sm:p-5",
                      selected ? "border-brand bg-brand-softer shadow-card" : "border-border hover:border-brand/50 hover:bg-surface-2/60",
                    )}
                  >
                    <span
                      className={cn(
                        "flex size-11 shrink-0 items-center justify-center rounded-xl border-2 text-lg font-bold transition-colors",
                        selected ? "border-brand bg-brand text-brand-ink" : "border-border bg-surface text-muted group-hover:border-brand/50",
                      )}
                    >
                      {LETTERS[i]}
                    </span>
                    <span className="flex-1 font-medium">{o.text}</span>
                    {selected ? <Check className="size-6 shrink-0 text-brand" aria-hidden /> : null}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="mt-4 flex items-center justify-between gap-3">
            <Button variant="secondary" size="lg" className="h-14 min-w-36" onClick={() => goTo(att.current - 1)} disabled={att.current === 0 || !allowBack}>
              ← Previous
            </Button>
            {att.current < att.questions.length - 1 ? (
              <Button size="lg" className="h-14 min-w-36" onClick={() => goTo(att.current + 1)}>
                Next →
              </Button>
            ) : (
              <Button size="lg" variant="accent" className="h-14 min-w-44" onClick={() => setReviewOpen(true)}>
                Finish &amp; submit
              </Button>
            )}
          </div>
          <p className="mt-3 hidden text-center text-xs text-muted sm:block">
            Tip: press <Kbd>A</Kbd> <Kbd>B</Kbd> <Kbd>C</Kbd> <Kbd>D</Kbd> to answer, and <Kbd>←</Kbd> <Kbd>→</Kbd> to move.
          </p>
        </main>

        <aside className="space-y-4">
          <div className="rounded-[28px] border border-border bg-surface p-5 shadow-card">
            <div className="flex items-center justify-between">
              <p className="font-bold">Questions</p>
              <p className="text-sm font-semibold text-muted">
                {answeredCount} of {att.questions.length} answered
              </p>
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-surface-2" aria-hidden>
              <div className="h-full rounded-full bg-success transition-[width]" style={{ width: `${(answeredCount / total) * 100}%` }} />
            </div>
            <div className="mt-4 grid grid-cols-5 gap-2">
              {att.questions.map((x, i) => {
                const a = att.answers[x.id];
                return (
                  <button
                    key={x.id}
                    onClick={() => goTo(i)}
                    disabled={!allowBack && i < att.current}
                    aria-label={`Question ${i + 1}${a?.s ? ", answered" : ""}${a?.f ? ", flagged" : ""}`}
                    className={cn(
                      "relative h-11 rounded-xl border-2 text-sm font-bold tabular-nums transition-colors disabled:opacity-40",
                      a?.s ? "border-brand bg-brand text-brand-ink" : "border-border bg-surface-2 text-muted hover:border-brand/50",
                      i === att.current && "ring-[3px] ring-accent ring-offset-2 ring-offset-surface",
                    )}
                  >
                    {i + 1}
                    {a?.f ? <span className="absolute -top-1.5 -right-1.5 size-3.5 rounded-full border-2 border-surface bg-accent" /> : null}
                  </button>
                );
              })}
            </div>
            <div className="mt-5 space-y-1.5 border-t border-border pt-4 text-xs font-medium text-muted">
              <p className="flex items-center gap-2">
                <span className="size-3.5 rounded bg-brand" /> Answered
              </p>
              <p className="flex items-center gap-2">
                <span className="size-3.5 rounded border-2 border-border bg-surface-2" /> Not answered
              </p>
              {allowFlag ? (
                <p className="flex items-center gap-2">
                  <span className="size-3.5 rounded-full bg-accent" /> Flagged for review
                </p>
              ) : null}
            </div>
          </div>
          <Button variant="secondary" size="lg" className="h-14 w-full" onClick={() => setReviewOpen(true)}>
            <ClipboardCheck /> Review &amp; submit
          </Button>
        </aside>
      </div>

      {reviewOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="review-title">
          <div className="w-full max-w-lg rounded-[28px] bg-surface p-7 shadow-float">
            <span className="inline-flex size-12 items-center justify-center rounded-2xl bg-brand-soft text-brand">
              <ClipboardCheck className="size-6" aria-hidden />
            </span>
            <h2 id="review-title" className="mt-4 text-2xl font-bold tracking-tight">
              Ready to submit?
            </h2>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <div className="rounded-2xl bg-success-soft p-4 text-success">
                <p className="text-3xl font-bold tabular-nums">{answeredCount}</p>
                <p className="text-sm font-semibold">of {att.questions.length} answered</p>
              </div>
              <div className="rounded-2xl bg-surface-2 p-4">
                <p className="font-mono text-3xl font-bold tabular-nums">{fmt(remaining)}</p>
                <p className="text-sm font-semibold text-muted">time left</p>
              </div>
            </div>
            <p className="sr-only">
              You have answered {answeredCount} of {att.questions.length} questions.
            </p>
            {unanswered.length ? (
              <div className="mt-5">
                <p className="text-sm font-semibold">Not answered:</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {unanswered.map((i) => (
                    <button
                      key={i}
                      className="h-10 min-w-10 rounded-xl border-2 border-border px-2 text-sm font-bold hover:border-brand disabled:opacity-40"
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
              <div className="mt-5">
                <p className="text-sm font-semibold">Flagged for review:</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {flagged.map((i) => (
                    <button
                      key={i}
                      className="h-10 min-w-10 rounded-xl border-2 border-accent px-2 text-sm font-bold"
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
              <p className="mt-5 rounded-2xl bg-warning-soft p-4 text-sm font-medium text-warning">
                You must answer every question before you can submit. (If time runs out, your exam is submitted automatically.)
              </p>
            ) : null}
            {att.lastError && !online ? null : att.lastError ? <p className="mt-3 text-sm text-danger">{att.lastError}</p> : null}
            <div className="mt-7 grid gap-3 sm:grid-cols-2">
              <Button variant="secondary" size="lg" className="h-14" onClick={() => setReviewOpen(false)}>
                Keep working
              </Button>
              <Button size="lg" variant="accent" className="h-14" disabled={Boolean(settings.require_all_answered && unanswered.length)} onClick={submit}>
                Submit now
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="rounded-md border border-border bg-surface px-1.5 py-0.5 font-sans text-[11px] font-semibold text-text">{children}</kbd>;
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-hero flex min-h-screen items-center justify-center p-6">
      <div className="flex max-w-xl flex-col items-center rounded-[32px] border border-border bg-surface p-10 text-center shadow-float">{children}</div>
    </div>
  );
}

function ScoreRing({ pct }: { pct: number }) {
  const r = 54;
  const c = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 128 128" className="size-40" aria-hidden>
      <circle cx="64" cy="64" r={r} fill="none" stroke="var(--surface-2)" strokeWidth="12" />
      <circle
        cx="64"
        cy="64"
        r={r}
        fill="none"
        stroke={pct >= 50 ? "var(--success)" : "var(--warning)"}
        strokeWidth="12"
        strokeLinecap="round"
        strokeDasharray={`${(pct / 100) * c} ${c}`}
        transform="rotate(-90 64 64)"
      />
    </svg>
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
    <div className="bg-hero min-h-screen px-4 py-12">
      <div className="mx-auto max-w-3xl">
        <div className="rounded-[32px] border border-border bg-surface p-8 text-center shadow-float sm:p-12">
          <span className="mx-auto inline-flex size-16 items-center justify-center rounded-3xl bg-success-soft text-success">
            <PartyPopper className="size-8" aria-hidden />
          </span>
          <h1 className="mt-5 text-3xl font-bold tracking-tight sm:text-4xl">{r.status === "voided" ? "This attempt was cancelled" : "Exam submitted"}</h1>
          <p className="mt-2 text-lg text-muted">
            Well done, {att.student.first_name}! {att.assessment.subject} — {att.assessment.title}
          </p>
          {r.show !== "none" && r.score != null ? (
            <div className="mt-8 flex flex-col items-center">
              <div className="relative">
                <ScoreRing pct={pct ?? 0} />
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-4xl font-extrabold tabular-nums">{pct}%</span>
                </div>
              </div>
              <p className="mt-3 text-2xl font-bold tabular-nums">
                {Number(r.score)} <span className="text-lg text-muted">/ {Number(r.max_score)}</span>
              </p>
              <p className="text-sm text-muted">Your score</p>
            </div>
          ) : r.status === "submitted" ? (
            <p className="mt-6 text-lg">Your teacher will share your results.</p>
          ) : null}
        </div>
        {r.show === "full" && r.review ? (
          <div className="mt-8 space-y-3">
            <h2 className="text-lg font-bold">Corrections</h2>
            {r.review.map((row, i) => {
              const q = byId.get(row.q);
              if (!q) return null;
              const correct = row.s === row.a;
              const label = (key: string | null) => {
                const idx = q.options.findIndex((o) => o.key === key);
                return idx >= 0 ? `${LETTERS[idx]}. ${q.options[idx].text}` : "No answer";
              };
              return (
                <div key={row.q} className={cn("rounded-2xl border-2 bg-surface p-5", correct ? "border-success/40" : "border-danger/40")}>
                  <p className="font-semibold">
                    {i + 1}. {q.body}
                  </p>
                  <p className={cn("mt-2 text-sm font-medium", correct ? "text-success" : "text-danger")}>Your answer: {label(row.s)}</p>
                  {!correct ? <p className="text-sm font-medium text-success">Correct answer: {label(row.a)}</p> : null}
                </div>
              );
            })}
          </div>
        ) : null}
        <div className="mt-10 text-center">
          <Button size="lg" className="h-14 min-w-64 text-lg" onClick={onFinish}>
            Finish — next student
          </Button>
          <p className="mt-2 text-xs text-muted">This screen closes by itself in {countdown}s.</p>
        </div>
      </div>
    </div>
  );
}
