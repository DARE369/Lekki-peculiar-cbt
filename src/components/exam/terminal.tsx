"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Logo } from "@/components/brand";
import { Alert, Avatar, Button, Input, cn } from "@/components/ui";
import { ExamRunner } from "./runner";
import { ApiError, api, clearAttempt, forgetTerminal, loadAttempt, loadTerminal, saveAttempt, saveTerminal, type TerminalIdentity } from "./store";
import type { AvailableExam, ExamQuestion, LocalAttempt, StudentCard } from "./types";

type Method = "admission_no" | "name_search";
interface Session {
  token: string;
  student: StudentCard;
  method: Method;
  exams: AvailableExam[];
}
type Screen =
  | { name: "boot" }
  | { name: "register" }
  | { name: "identify"; error?: string }
  | { name: "suggest"; students: StudentCard[] }
  | { name: "classes" }
  | { name: "names"; cls: { id: string; name: string } }
  | { name: "confirm"; student: StudentCard; method: Method }
  | { name: "exams"; session: Session }
  | { name: "consent"; session: Session; exam: AvailableExam };

const IDLE_MS = 3 * 60_000;

export function ExamTerminal() {
  const [terminal, setTerminal] = useState<TerminalIdentity | null>(null);
  const [screen, setScreen] = useState<Screen>({ name: "boot" });
  const [attempt, setAttempt] = useState<LocalAttempt | null>(null);
  const [resumed, setResumed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lastActivity = useRef(0);

  // Boot: registered computer? unfinished exam on this computer?
  useEffect(() => {
    lastActivity.current = Date.now();
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js", { scope: "/exam" }).catch(() => {});
    const t = loadTerminal();
    void (async () => {
      const a = await loadAttempt();
      setTerminal(t);
      if (a) {
        setResumed(true);
        setAttempt(a);
      }
      setScreen(t ? { name: "identify" } : { name: "register" });
    })();
  }, []);

  // Idle reset on the login screens so the next student never lands on someone else's session.
  useEffect(() => {
    const bump = () => (lastActivity.current = Date.now());
    window.addEventListener("pointerdown", bump);
    window.addEventListener("keydown", bump);
    const t = setInterval(() => {
      if (attempt) return;
      if (["identify", "register", "boot"].includes(screen.name)) return;
      if (Date.now() - lastActivity.current > IDLE_MS) setScreen({ name: "identify" });
    }, 10_000);
    return () => {
      window.removeEventListener("pointerdown", bump);
      window.removeEventListener("keydown", bump);
      clearInterval(t);
    };
  }, [screen.name, attempt]);

  const go = useCallback((s: Screen) => {
    setError(null);
    setScreen(s);
  }, []);

  async function call<T>(fn: () => Promise<T>): Promise<T | null> {
    setBusy(true);
    setError(null);
    try {
      return await fn();
    } catch (e) {
      const err = e as ApiError;
      if (err.code === "terminal") {
        forgetTerminal();
        setTerminal(null);
        go({ name: "register" });
      }
      setError(err.code === "offline" ? "No internet connection. Check the network and try again." : err.message);
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function openSession(student: StudentCard, method: Method) {
    if (!terminal) return;
    const res = await call(() =>
      api<{ token: string; student: StudentCard; exams: AvailableExam[] }>("session", terminal.token, { studentId: student.id, method }),
    );
    if (res) go({ name: "exams", session: { token: res.token, student: res.student, exams: res.exams, method } });
  }

  async function startExam(session: Session, exam: AvailableExam) {
    if (!terminal) return;
    try {
      await document.documentElement.requestFullscreen?.();
    } catch {
      /* fullscreen is best-effort */
    }
    const res = await call(() =>
      api<{
        token: string;
        attempt: { id: string; deadline: string };
        assessment: LocalAttempt["assessment"];
        questions: ExamQuestion[];
        answers: { q: string; s: string | null; f: boolean; at: string }[];
        server_now: string;
      }>("start", terminal.token, { windowId: exam.window_id }, session.token),
    );
    if (!res) {
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
      return;
    }
    const local: LocalAttempt = {
      version: 1,
      token: res.token,
      attemptId: res.attempt.id,
      student: session.student,
      assessment: res.assessment,
      questions: res.questions,
      deadline: res.attempt.deadline,
      offsetMs: Date.parse(res.server_now) - Date.now(),
      answers: Object.fromEntries(res.answers.map((x) => [x.q, { s: x.s, f: x.f, at: x.at }])),
      dirty: [],
      events: [],
      current: 0,
      sealed: null,
      result: null,
      lastSyncAt: new Date().toISOString(),
      lastError: null,
    };
    await saveAttempt(local);
    setResumed(false);
    setAttempt(local);
  }

  async function finish() {
    await clearAttempt();
    setAttempt(null);
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    go({ name: "identify" });
  }

  if (attempt && terminal) {
    return <ExamRunner initial={attempt} terminalToken={terminal.token} resumed={resumed} onFinish={finish} />;
  }

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex items-center justify-between border-b border-border bg-surface px-6 py-3">
        <Logo />
        <div className="flex items-center gap-4 text-xs text-muted">
          <DisplayToggles />
          {terminal ? <span>{terminal.name}</span> : null}
        </div>
      </header>
      <main className="flex flex-1 items-start justify-center px-4 py-10 sm:py-16">
        <div className="w-full max-w-3xl">
          {error ? (
            <div className="mb-6">
              <Alert tone="danger">{error}</Alert>
            </div>
          ) : null}
          {screen.name === "boot" ? <p className="text-center text-muted">Loading…</p> : null}
          {screen.name === "register" ? (
            <Register
              busy={busy}
              onDone={async (code, name) => {
                const res = await call(() =>
                  fetch("/api/exam/register", {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({ code, name }),
                  }).then(async (r) => {
                    const j = await r.json();
                    if (!r.ok) throw new ApiError(j.error, j.message, r.status);
                    return j as { token: string; name: string };
                  }),
                );
                if (res) {
                  saveTerminal(res);
                  setTerminal(res);
                  go({ name: "identify" });
                }
              }}
            />
          ) : null}
          {screen.name === "identify" && terminal ? (
            <Identify
              busy={busy}
              onSubmit={async (admission) => {
                const res = await call(() => api<{ exact: boolean; students: StudentCard[] }>("identify", terminal.token, { admission }));
                if (!res) return;
                if (res.exact && res.students.length === 1) go({ name: "confirm", student: res.students[0], method: "admission_no" });
                else if (res.students.length) go({ name: "suggest", students: res.students });
                else setError("We couldn't find that admission number. Check it and try again, or press “I don't know my number”.");
              }}
              onForgot={() => go({ name: "classes" })}
            />
          ) : null}
          {screen.name === "suggest" ? (
            <div>
              <h1 className="text-2xl font-semibold">Did you mean…?</h1>
              <p className="mt-1 text-muted">That number wasn&apos;t exact. Tap your picture if you see yourself.</p>
              <StudentGrid students={screen.students} onPick={(s) => go({ name: "confirm", student: s, method: "admission_no" })} />
              <div className="mt-8 flex flex-wrap gap-3">
                <Button variant="secondary" size="lg" onClick={() => go({ name: "identify" })}>
                  ← Type it again
                </Button>
                <Button variant="secondary" size="lg" onClick={() => go({ name: "classes" })}>
                  I don&apos;t know my number
                </Button>
              </div>
            </div>
          ) : null}
          {screen.name === "classes" && terminal ? (
            <ClassPicker terminalToken={terminal.token} onPick={(cls) => go({ name: "names", cls })} onBack={() => go({ name: "identify" })} />
          ) : null}
          {screen.name === "names" && terminal ? (
            <NameSearch
              terminalToken={terminal.token}
              cls={screen.cls}
              onPick={(s) => go({ name: "confirm", student: s, method: "name_search" })}
              onBack={() => go({ name: "classes" })}
            />
          ) : null}
          {screen.name === "confirm" ? (
            <div className="text-center">
              <h1 className="text-3xl font-semibold">Is this you?</h1>
              <div className="mt-8 flex flex-col items-center gap-4">
                <Avatar src={screen.student.photo_url} name={screen.student.name} size={180} />
                <p className="text-3xl font-semibold">{screen.student.name}</p>
                <p className="text-lg text-muted">{screen.student.class_name}</p>
              </div>
              <div className="mt-10 flex flex-wrap justify-center gap-4">
                <Button size="lg" className="min-w-48 text-lg" disabled={busy} onClick={() => openSession(screen.student, screen.method)}>
                  {busy ? "Please wait…" : "Yes, this is me"}
                </Button>
                <Button size="lg" variant="secondary" className="min-w-48 text-lg" onClick={() => go({ name: "identify" })}>
                  No, go back
                </Button>
              </div>
            </div>
          ) : null}
          {screen.name === "exams" && terminal ? (
            <ExamList
              terminalToken={terminal.token}
              session={screen.session}
              onUpdate={(exams) => setScreen({ name: "exams", session: { ...screen.session, exams } })}
              onPick={(exam) => go({ name: "consent", session: screen.session, exam })}
              onLogout={() => go({ name: "identify" })}
            />
          ) : null}
          {screen.name === "consent" ? (
            <Consent
              session={screen.session}
              exam={screen.exam}
              busy={busy}
              onStart={() => startExam(screen.session, screen.exam)}
              onBack={() => go({ name: "exams", session: screen.session })}
            />
          ) : null}
        </div>
      </main>
    </div>
  );
}

function readPref(key: string) {
  try {
    return typeof window === "undefined" ? null : localStorage.getItem(key);
  } catch {
    return null;
  }
}

function DisplayToggles() {
  const [big, setBig] = useState(() => readPref("cbt.big") === "1");
  const [dark, setDark] = useState<boolean | null>(() => {
    const d = readPref("cbt.theme");
    return d === "dark" ? true : d === "light" ? false : null;
  });
  useEffect(() => {
    document.documentElement.style.fontSize = big ? "118%" : "";
    if (dark === null) document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
  }, [big, dark]);
  return (
    <span className="flex gap-2">
      <button
        className="rounded border border-border px-2 py-1"
        onClick={() => {
          setBig(!big);
          localStorage.setItem("cbt.big", big ? "0" : "1");
        }}
        aria-pressed={big}
        suppressHydrationWarning
      >
        A{big ? "−" : "+"}
      </button>
      <button
        className="rounded border border-border px-2 py-1"
        onClick={() => {
          const next = !(dark ?? window.matchMedia("(prefers-color-scheme: dark)").matches);
          setDark(next);
          localStorage.setItem("cbt.theme", next ? "dark" : "light");
        }}
        suppressHydrationWarning
      >
        {dark ? "Light" : "Dark"}
      </button>
    </span>
  );
}

function Register({ busy, onDone }: { busy: boolean; onDone: (code: string, name: string) => void }) {
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  return (
    <form
      className="mx-auto max-w-md space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        onDone(code, name);
      }}
    >
      <h1 className="text-2xl font-semibold">Register this computer</h1>
      <p className="text-sm text-muted">
        A one-time step for staff. Get a registration code from <strong>Admin → Lab computers</strong>.
      </p>
      <label className="block space-y-1.5">
        <span className="text-sm font-medium">Registration code</span>
        <Input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" placeholder="1234 5678" className="h-12 font-mono text-lg" required />
      </label>
      <label className="block space-y-1.5">
        <span className="text-sm font-medium">Name for this computer</span>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Lab 1 – PC 14" className="h-12" required />
      </label>
      <Button size="lg" className="w-full" disabled={busy}>
        {busy ? "Registering…" : "Register"}
      </Button>
    </form>
  );
}

function Identify({ busy, onSubmit, onForgot }: { busy: boolean; onSubmit: (v: string) => void; onForgot: () => void }) {
  const [value, setValue] = useState("");
  return (
    <div className="mx-auto max-w-xl text-center">
      <h1 className="text-3xl font-semibold sm:text-4xl">Welcome!</h1>
      <p className="mt-2 text-lg text-muted">Type your admission number to begin.</p>
      <form
        className="mt-8 space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (value.trim()) onSubmit(value);
        }}
      >
        <input
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value.toUpperCase())}
          placeholder="e.g. LPS/2024/0137"
          autoComplete="off"
          spellCheck={false}
          aria-label="Admission number"
          className="h-16 w-full rounded-xl border-2 border-border bg-surface px-5 text-center font-mono text-2xl tracking-wider focus:border-brand focus:outline-none"
        />
        <Button size="lg" className="h-14 w-full text-lg" disabled={busy || !value.trim()}>
          {busy ? "Checking…" : "Continue"}
        </Button>
      </form>
      <div className="my-8 flex items-center gap-3 text-sm text-muted">
        <span className="h-px flex-1 bg-border" /> or <span className="h-px flex-1 bg-border" />
      </div>
      <Button variant="secondary" size="lg" className="h-14 w-full text-lg" onClick={onForgot}>
        I don&apos;t know my number
      </Button>
    </div>
  );
}

function StudentGrid({ students, onPick }: { students: StudentCard[]; onPick: (s: StudentCard) => void }) {
  return (
    <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
      {students.map((s) => (
        <button
          key={s.id}
          onClick={() => onPick(s)}
          className="flex flex-col items-center gap-2 rounded-2xl border-2 border-border bg-surface p-4 text-center transition hover:border-brand focus:border-brand focus:outline-none"
        >
          <Avatar src={s.photo_url} name={s.name} size={96} />
          <span className="font-semibold">{s.name}</span>
          <span className="text-xs text-muted">{s.class_name}</span>
        </button>
      ))}
    </div>
  );
}

function ClassPicker({
  terminalToken,
  onPick,
  onBack,
}: {
  terminalToken: string;
  onPick: (c: { id: string; name: string }) => void;
  onBack: () => void;
}) {
  const [classes, setClasses] = useState<{ id: string; name: string; section: string }[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    api<{ classes: { id: string; name: string; section: string }[] }>("classes", terminalToken, {})
      .then((r) => setClasses(r.classes))
      .catch((e: ApiError) => setErr(e.message));
  }, [terminalToken]);
  const sections = [...new Set((classes ?? []).map((c) => c.section))];
  return (
    <div>
      <h1 className="text-2xl font-semibold">Which class are you in?</h1>
      {err ? <Alert tone="danger">{err}</Alert> : null}
      {!classes && !err ? <p className="mt-6 text-muted">Loading classes…</p> : null}
      {sections.map((sec) => (
        <div key={sec} className="mt-6">
          <p className="mb-2 text-sm font-medium text-muted">{sec}</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {(classes ?? [])
              .filter((c) => c.section === sec)
              .map((c) => (
                <button
                  key={c.id}
                  onClick={() => onPick(c)}
                  className="h-16 rounded-xl border-2 border-border bg-surface text-lg font-semibold hover:border-brand focus:border-brand focus:outline-none"
                >
                  {c.name}
                </button>
              ))}
          </div>
        </div>
      ))}
      <Button variant="secondary" size="lg" className="mt-8" onClick={onBack}>
        ← Back
      </Button>
    </div>
  );
}

function NameSearch({
  terminalToken,
  cls,
  onPick,
  onBack,
}: {
  terminalToken: string;
  cls: { id: string; name: string };
  onPick: (s: StudentCard) => void;
  onBack: () => void;
}) {
  const [q, setQ] = useState("");
  const [students, setStudents] = useState<StudentCard[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    const t = setTimeout(() => {
      api<{ students: StudentCard[] }>("search", terminalToken, { classId: cls.id, q })
        .then((r) => {
          setStudents(r.students);
          setErr(null);
        })
        .catch((e: ApiError) => setErr(e.message));
    }, 250);
    return () => clearTimeout(t);
  }, [q, cls.id, terminalToken]);
  return (
    <div>
      <h1 className="text-2xl font-semibold">{cls.name}: find your name</h1>
      <p className="mt-1 text-muted">Type the first few letters of your first name or surname, then tap your picture.</p>
      <input
        autoFocus
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Start typing your name…"
        aria-label="Your name"
        className="mt-6 h-14 w-full rounded-xl border-2 border-border bg-surface px-5 text-xl focus:border-brand focus:outline-none"
      />
      {err ? (
        <div className="mt-4">
          <Alert tone="danger">{err}</Alert>
        </div>
      ) : null}
      {students && students.length === 0 ? <p className="mt-6 text-muted">No match. Try fewer letters, or ask your supervisor.</p> : null}
      {students ? <StudentGrid students={students} onPick={onPick} /> : null}
      <Button variant="secondary" size="lg" className="mt-8" onClick={onBack}>
        ← Choose another class
      </Button>
    </div>
  );
}

function when(iso: string) {
  return new Date(iso).toLocaleTimeString("en-NG", { hour: "numeric", minute: "2-digit", timeZone: "Africa/Lagos" });
}

function ExamList({
  terminalToken,
  session,
  onUpdate,
  onPick,
  onLogout,
}: {
  terminalToken: string;
  session: Session;
  onUpdate: (e: AvailableExam[]) => void;
  onPick: (e: AvailableExam) => void;
  onLogout: () => void;
}) {
  const waiting = session.exams.some((e) => e.state === "awaiting_start" || e.state === "scheduled" || e.state === "paused");
  const onUpdateRef = useRef(onUpdate);
  useEffect(() => {
    onUpdateRef.current = onUpdate;
  });
  useEffect(() => {
    if (!waiting) return;
    const t = setInterval(() => {
      api<{ exams: AvailableExam[] }>("exams", terminalToken, {}, session.token)
        .then((r) => onUpdateRef.current(r.exams))
        .catch(() => {});
    }, 8000);
    return () => clearInterval(t);
  }, [waiting, terminalToken, session.token]);

  const exams = session.exams.filter((e) => e.state !== "closed" || e.attempt_status);
  return (
    <div>
      <div className="flex items-center gap-4">
        <Avatar src={session.student.photo_url} name={session.student.name} size={64} />
        <div>
          <h1 className="text-2xl font-semibold">Hello, {session.student.first_name}</h1>
          <p className="text-muted">{session.student.class_name}</p>
        </div>
      </div>
      <h2 className="mt-8 mb-3 text-lg font-semibold">Your exams</h2>
      {exams.length === 0 ? (
        <Alert tone="info" title="No exam for you right now">
          If you think this is wrong, tell your supervisor.
        </Alert>
      ) : (
        <div className="space-y-3">
          {exams.map((e) => (
            <div key={e.window_id} className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-border bg-surface p-5">
              <div>
                <p className="text-sm text-muted">
                  {e.subject} · {e.type}
                  {e.is_makeup ? " · make-up" : ""}
                </p>
                <p className="text-xl font-semibold">{e.title}</p>
                <p className="text-sm text-muted">
                  {e.question_count} questions · {e.duration_minutes} minutes · {when(e.starts_at)}–{when(e.ends_at)}
                </p>
              </div>
              {e.attempt_status === "submitted" ? (
                <span className="rounded-full bg-success-soft px-4 py-2 font-medium text-success">Submitted ✓</span>
              ) : e.state === "live" ? (
                <Button size="lg" onClick={() => onPick(e)}>
                  {e.attempt_status === "in_progress" ? "Continue" : "Start"}
                </Button>
              ) : (
                <span className={cn("flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium", "bg-warning-soft text-warning")}>
                  <span className="h-2 w-2 animate-pulse rounded-full bg-current" />
                  {e.state === "awaiting_start"
                    ? "Waiting for your supervisor to start"
                    : e.state === "paused"
                      ? "Paused — please wait"
                      : e.state === "scheduled"
                        ? `Opens at ${when(e.starts_at)}`
                        : "Closed"}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
      <Button variant="secondary" size="lg" className="mt-8" onClick={onLogout}>
        This isn&apos;t me / Log out
      </Button>
    </div>
  );
}

function Consent({
  session,
  exam,
  busy,
  onStart,
  onBack,
}: {
  session: Session;
  exam: AvailableExam;
  busy: boolean;
  onStart: () => void;
  onBack: () => void;
}) {
  const [agreed, setAgreed] = useState(false);
  return (
    <div className="rounded-2xl border border-border bg-surface p-6 sm:p-8">
      <p className="text-sm font-medium text-accent">Before you start</p>
      <h1 className="mt-1 text-2xl font-semibold">{exam.title}</h1>
      <dl className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[
          ["Subject", exam.subject],
          ["Class", session.student.class_name],
          ["Questions", String(exam.question_count)],
          ["Time", `${exam.duration_minutes} minutes`],
        ].map(([k, v]) => (
          <div key={k} className="rounded-xl bg-surface-2 p-3">
            <dt className="text-xs text-muted">{k}</dt>
            <dd className="text-lg font-semibold">{v}</dd>
          </div>
        ))}
      </dl>
      {exam.instructions ? <p className="mt-6 whitespace-pre-wrap">{exam.instructions}</p> : null}
      <ul className="mt-6 list-disc space-y-1 pl-5 text-sm text-muted">
        <li>The timer starts as soon as you press Start and keeps running even if the internet goes off.</li>
        <li>Your answers are saved on this computer automatically. Don&apos;t close the browser.</li>
        <li>Stay on the exam screen. Leaving it is recorded.</li>
        <li>When time runs out, your exam is submitted automatically.</li>
      </ul>
      <label className="mt-6 flex items-start gap-3 rounded-xl border border-border p-4">
        <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="mt-1 h-5 w-5 accent-[var(--brand)]" />
        <span>
          I am <strong>{session.student.name}</strong>, and I will do this exam on my own.
        </span>
      </label>
      <div className="mt-6 flex flex-wrap gap-3">
        <Button size="lg" className="min-w-48 text-lg" disabled={!agreed || busy} onClick={onStart}>
          {busy ? "Starting…" : "Start exam"}
        </Button>
        <Button size="lg" variant="secondary" onClick={onBack}>
          Back
        </Button>
      </div>
    </div>
  );
}
