"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Calculator as CalcIcon, Delete, X } from "lucide-react";
import { calculate, CALC_ALLOWED, normalise } from "@/lib/calc";
import { cn } from "@/components/ui";

const KEYS: { label: string; aria: string; kind: "digit" | "op" | "fn" | "equals"; value?: string }[] = [
  { label: "C", aria: "Clear", kind: "fn" },
  { label: "(", aria: "Open bracket", kind: "op", value: "(" },
  { label: ")", aria: "Close bracket", kind: "op", value: ")" },
  { label: "÷", aria: "Divide", kind: "op", value: "÷" },
  { label: "7", aria: "7", kind: "digit", value: "7" },
  { label: "8", aria: "8", kind: "digit", value: "8" },
  { label: "9", aria: "9", kind: "digit", value: "9" },
  { label: "×", aria: "Multiply", kind: "op", value: "×" },
  { label: "4", aria: "4", kind: "digit", value: "4" },
  { label: "5", aria: "5", kind: "digit", value: "5" },
  { label: "6", aria: "6", kind: "digit", value: "6" },
  { label: "−", aria: "Minus", kind: "op", value: "−" },
  { label: "1", aria: "1", kind: "digit", value: "1" },
  { label: "2", aria: "2", kind: "digit", value: "2" },
  { label: "3", aria: "3", kind: "digit", value: "3" },
  { label: "+", aria: "Plus", kind: "op", value: "+" },
  { label: "0", aria: "0", kind: "digit", value: "0" },
  { label: ".", aria: "Decimal point", kind: "digit", value: "." },
  { label: "⌫", aria: "Backspace", kind: "fn" },
  { label: "=", aria: "Equals", kind: "equals" },
];

/** What the student sees: the typed symbols tidied into × ÷ −. */
const pretty = (s: string) => s.replace(/[*]/g, "×").replace(/[/]/g, "÷").replace(/x/gi, "×").replace(/[-–]/g, "−");

/**
 * A basic calculator for the exam screen: + − × ÷, brackets and decimal points, by mouse or keyboard.
 * It stays mounted while the student moves between questions, so their working is still there.
 */
export type CalcUseEntry = { q: string; n: number; expr: string; result: string };

/** The most sums recorded for one exam: enough for any real use, and it stops a flood of entries. */
const MAX_LOGGED = 150;

export function Calculator({ question, onUse }: { question: { id: string; number: number } | null; onUse?: (entry: CalcUseEntry) => void }) {
  const [open, setOpen] = useState(false);
  const [expr, setExpr] = useState("");
  const [shownResult, setShownResult] = useState(false); // the box holds an answer: a digit starts a new sum
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null); // where the window sits once moved
  const drag = useRef<{ dx: number; dy: number } | null>(null);
  const [mounted, setMounted] = useState(false);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setMounted(true), []); // the window is drawn over the page, which needs the browser
  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);

  const live = expr && !shownResult ? calculate(expr) : null;
  const preview = live && live.ok && /[+\-−×÷*/x(]/i.test(expr.replace(/^[-−]/, "")) ? live.text : null;

  // ---- Record what was worked out, and on which question, so a teacher can review it later.
  const questionRef = useRef(question);
  const onUseRef = useRef(onUse);
  // Keep the latest question and callback where timers and cleanups can read them (declared first, so it runs first).
  useEffect(() => {
    questionRef.current = question;
    onUseRef.current = onUse;
  });
  const logged = useRef({ count: 0, lastKey: "" });
  const pending = useRef<{ entry: CalcUseEntry; timer: ReturnType<typeof setTimeout> } | null>(null);

  function record(entry: CalcUseEntry) {
    const key = `${entry.q}|${normalise(entry.expr)}`;
    if (logged.current.count >= MAX_LOGGED || key === logged.current.lastKey) return;
    logged.current.lastKey = key;
    logged.current.count++;
    onUseRef.current?.({ ...entry, expr: entry.expr.slice(0, 80), result: entry.result.slice(0, 40) });
  }
  /** Records a sum that was shown but not yet recorded (the student moved on, or closed the calculator). */
  function flush() {
    if (!pending.current) return;
    clearTimeout(pending.current.timer);
    const { entry } = pending.current;
    pending.current = null;
    record(entry);
  }
  // A result seen in the live preview counts even if "=" was never pressed: record it once it has stayed put.
  useEffect(() => {
    if (pending.current) {
      clearTimeout(pending.current.timer);
      pending.current = null;
    }
    const qn = questionRef.current;
    if (!preview || !qn || shownResult) return;
    const entry = { q: qn.id, n: qn.number, expr, result: preview };
    pending.current = {
      entry,
      timer: setTimeout(() => {
        pending.current = null;
        record(entry);
      }, 1500),
    };
  }, [expr, preview, shownResult]);
  // Leaving a question, closing the calculator, or finishing the exam: keep what has been seen.
  const questionId = question?.id;
  useEffect(() => flush, [questionId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!open) flush();
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const WIDTH = 288;
  const place = pos ?? { x: Math.max(8, (typeof window === "undefined" ? 1000 : window.innerWidth) - WIDTH - 16), y: 88 };


  function press(value: string, kind: "digit" | "op") {
    setError("");
    // After an answer: a number starts afresh, an operator carries on from the answer.
    setExpr(shownResult && kind === "digit" ? value : expr + value);
    setShownResult(false);
    input.current?.focus();
  }
  function evaluate() {
    if (!expr.trim()) return;
    const r = calculate(expr);
    if (r.ok) {
      const qn = questionRef.current;
      if (qn) {
        if (pending.current) {
          clearTimeout(pending.current.timer);
          pending.current = null;
        }
        record({ q: qn.id, n: qn.number, expr, result: r.text });
      }
      setExpr(r.text);
      setShownResult(true);
      setError("");
    } else setError(r.error);
    input.current?.focus();
  }
  function clear() {
    setExpr("");
    setError("");
    setShownResult(false);
    input.current?.focus();
  }
  function backspace() {
    setError("");
    setShownResult(false);
    setExpr((c) => c.slice(0, -1));
    input.current?.focus();
  }

  const panel = open ? (
    <div
      role="dialog"
      aria-label="Calculator"
      style={{ left: place.x, top: place.y, width: `min(${WIDTH}px, calc(100vw - 1rem))` }}
      className="animate-fade fixed z-[60] rounded-2xl border border-border bg-surface p-3 shadow-float select-text"
      // Keys typed in here belong to the calculator, not to the exam's answer shortcuts.
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape") setOpen(false);
      }}
    >
      <div
        className="mb-2 flex cursor-grab touch-none items-center justify-between active:cursor-grabbing"
        title="Drag to move"
        onPointerDown={(e) => {
          if ((e.target as HTMLElement).closest("button")) return;
          drag.current = { dx: e.clientX - place.x, dy: e.clientY - place.y };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (!drag.current) return;
          const maxX = window.innerWidth - 80;
          const maxY = window.innerHeight - 60;
          setPos({ x: Math.min(maxX, Math.max(-WIDTH + 80, e.clientX - drag.current.dx)), y: Math.min(maxY, Math.max(0, e.clientY - drag.current.dy)) });
        }}
        onPointerUp={() => (drag.current = null)}
      >
        <span className="flex items-center gap-1.5 text-sm font-semibold">
          <CalcIcon className="size-4 text-brand" aria-hidden /> Calculator
        </span>
        <button type="button" onClick={() => setOpen(false)} aria-label="Close calculator" className="inline-flex size-7 items-center justify-center rounded-md text-muted hover:bg-surface-2 hover:text-text">
          <X className="size-4" aria-hidden />
        </button>
      </div>

      <div className="mb-3 rounded-xl bg-surface-2 px-3 py-2 text-right">
        <input
          ref={input}
          value={expr}
          onChange={(e) => {
            const v = e.target.value;
            if (!CALC_ALLOWED.test(v)) return; // ignore letters and symbols that aren't part of a sum
            setError("");
            if (shownResult) setShownResult(false);
            setExpr(pretty(v));
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === "=") {
              e.preventDefault();
              evaluate();
            }
          }}
          inputMode="none"
          autoComplete="off"
          spellCheck={false}
          aria-label="Your sum"
          placeholder="0"
          dir="ltr"
          className="w-full bg-transparent text-right text-2xl font-semibold tabular-nums outline-none placeholder:text-subtle"
        />
        <p className={cn("min-h-5 text-sm tabular-nums", error ? "text-danger" : "text-muted")} aria-live="polite" role="status">
          {error ? error : preview ? `= ${preview}` : ""}
        </p>
      </div>

      <div className="grid grid-cols-4 gap-1.5">
        {KEYS.map((k) => (
          <button
            key={k.label}
            type="button"
            aria-label={k.aria}
            onClick={() => {
              if (k.kind === "fn") (k.label === "C" ? clear : backspace)();
              else if (k.kind === "equals") evaluate();
              else press(k.value!, k.kind);
            }}
            className={cn(
              "inline-flex h-11 items-center justify-center rounded-lg text-lg font-semibold transition-colors active:scale-95",
              k.kind === "digit" && "bg-surface-2 text-text hover:bg-border",
              k.kind === "op" && "bg-brand-soft text-brand hover:bg-brand/20",
              k.kind === "fn" && "bg-warning-soft text-warning hover:bg-warning/20",
              k.kind === "equals" && "bg-brand text-brand-ink hover:bg-brand-hover",
            )}
          >
            {k.label === "⌫" ? <Delete className="size-5" aria-hidden /> : k.label}
          </button>
        ))}
      </div>
      <p className="mt-2 text-center text-xs text-muted">You can also type on the keyboard. Enter gives the answer.</p>
    </div>
  ) : null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label={open ? "Close calculator" : "Open calculator"}
        className={cn(
          "inline-flex h-10 items-center gap-2 rounded-full border px-3 text-sm font-semibold transition-colors sm:px-4",
          open ? "border-brand bg-brand-soft text-brand" : "border-border bg-surface hover:border-brand hover:text-brand",
        )}
      >
        <CalcIcon className="size-5" aria-hidden />
        <span className="hidden sm:inline">Calculator</span>
      </button>
      {mounted && panel ? createPortal(panel, document.body) : null}
    </>
  );
}
