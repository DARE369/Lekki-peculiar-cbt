"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  BookOpen,
  CircleHelp,
  Clock3,
  Hourglass,
  ListChecks,
  LogOut,
  MonitorSmartphone,
  PlayCircle,
  Search,
  ShieldCheck,
  Type,
  UserRound,
  UsersRound,
} from "lucide-react";
import { Crest } from "@/components/brand";
import { ThemeSwitcher } from "@/components/theme";
import { Alert, Avatar, Button, Input, cn } from "@/components/ui";
import { brand } from "@/lib/brand";
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
    <div className="bg-hero flex min-h-screen flex-col">
      <header className="flex items-center justify-between gap-4 px-5 py-4 sm:px-8">
        <div className="flex items-center gap-3">
          <Crest size={44} />
          <div className="leading-tight">
            <p className="font-bold tracking-tight">{brand.schoolName}</p>
            <p className="text-xs font-medium text-muted">Exam centre</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {terminal ? (
            <span className="hidden items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1.5 text-xs font-medium text-muted sm:inline-flex">
              <MonitorSmartphone className="size-3.5" aria-hidden /> {terminal.name}
            </span>
          ) : null}
          <TextSizeToggle />
          <ThemeSwitcher compact />
        </div>
      </header>
      <main className="flex flex-1 items-start justify-center px-4 pt-6 pb-16 sm:pt-12">
        <div className="w-full max-w-4xl">
          {error ? (
            <div className="mx-auto mb-6 max-w-2xl">
              <Alert tone="danger">{error}</Alert>
            </div>
          ) : null}
          {screen.name === "boot" ? (
            <div className="flex justify-center py-24">
              <span className="size-10 animate-spin rounded-full border-4 border-brand-soft border-t-brand" aria-label="Loading" />
            </div>
          ) : null}
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
            <Panel icon={Search} title="Did you mean…?" subtitle="That number wasn't exact. Tap your picture if you see yourself.">
              <StudentGrid students={screen.students} onPick={(s) => go({ name: "confirm", student: s, method: "admission_no" })} />
              <div className="mt-8 flex flex-wrap justify-center gap-3">
                <Button variant="secondary" size="lg" onClick={() => go({ name: "identify" })}>
                  <ArrowLeft /> Type it again
                </Button>
                <Button variant="soft" size="lg" onClick={() => go({ name: "classes" })}>
                  <CircleHelp /> I don&apos;t know my number
                </Button>
              </div>
            </Panel>
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
            <div className="mx-auto max-w-xl rounded-[28px] border border-border bg-surface p-8 text-center shadow-float sm:p-10">
              <p className="text-sm font-semibold tracking-wide text-brand uppercase">Check it&apos;s you</p>
              <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">Is this you?</h1>
              <div className="mt-8 flex flex-col items-center gap-4">
                <span className="rounded-full bg-gradient-to-br from-brand to-accent p-1.5 shadow-card">
                  <Avatar src={screen.student.photo_url} name={screen.student.name} size={176} />
                </span>
                <p className="text-3xl font-bold tracking-tight">{screen.student.name}</p>
                <p className="inline-flex items-center gap-2 rounded-full bg-surface-2 px-4 py-1.5 font-medium text-muted">
                  <UsersRound className="size-4" aria-hidden /> {screen.student.class_name}
                </p>
              </div>
              <div className="mt-10 grid gap-3 sm:grid-cols-2">
                <Button size="lg" className="h-14 text-lg" disabled={busy} onClick={() => openSession(screen.student, screen.method)}>
                  {busy ? "Please wait…" : "Yes, this is me"}
                </Button>
                <Button size="lg" variant="secondary" className="h-14 text-lg" onClick={() => go({ name: "identify" })}>
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

function Panel({
  icon: Icon,
  title,
  subtitle,
  children,
}: {
  icon: typeof Search;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="mb-8 text-center">
        <span className="mx-auto inline-flex size-14 items-center justify-center rounded-2xl bg-brand-soft text-brand">
          <Icon className="size-7" aria-hidden />
        </span>
        <h1 className="mt-4 text-3xl font-bold tracking-tight">{title}</h1>
        {subtitle ? <p className="mx-auto mt-2 max-w-xl text-lg text-muted">{subtitle}</p> : null}
      </div>
      {children}
    </section>
  );
}

function TextSizeToggle() {
  const [big, setBig] = useState(() => readPref("cbt.big") === "1");
  useEffect(() => {
    document.documentElement.style.fontSize = big ? "118%" : "";
  }, [big]);
  return (
    <button
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold transition-colors",
        big ? "border-brand bg-brand-soft text-brand" : "border-border bg-surface-2 text-muted hover:text-text",
      )}
      onClick={() => {
        setBig(!big);
        try {
          localStorage.setItem("cbt.big", big ? "0" : "1");
        } catch {}
      }}
      aria-pressed={big}
      title="Larger text"
      suppressHydrationWarning
    >
      <Type className="size-3.5" aria-hidden /> <span suppressHydrationWarning>{big ? "Normal text" : "Bigger text"}</span>
    </button>
  );
}

function readPref(key: string) {
  try {
    return typeof window === "undefined" ? null : localStorage.getItem(key);
  } catch {
    return null;
  }
}

function Register({ busy, onDone }: { busy: boolean; onDone: (code: string, name: string) => void }) {
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  return (
    <form
      className="mx-auto max-w-md rounded-[28px] border border-border bg-surface p-8 shadow-float"
      onSubmit={(e) => {
        e.preventDefault();
        onDone(code, name);
      }}
    >
      <span className="inline-flex size-12 items-center justify-center rounded-2xl bg-accent-soft text-[color:var(--warning)] dark:text-accent">
        <MonitorSmartphone className="size-6" aria-hidden />
      </span>
      <h1 className="mt-4 text-2xl font-bold tracking-tight">Register this computer</h1>
      <p className="mt-1 text-sm text-muted">
        A one-time step for staff. Get a registration code from <strong>Admin → Lab computers</strong>.
      </p>
      <div className="mt-6 space-y-4">
        <label className="block space-y-1.5">
          <span className="text-[13px] font-semibold">Registration code</span>
          <Input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" placeholder="1234 5678" className="h-12 font-mono text-lg tracking-widest" required />
        </label>
        <label className="block space-y-1.5">
          <span className="text-[13px] font-semibold">Name for this computer</span>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Lab 1 – PC 14" className="h-12" required />
        </label>
        <Button size="lg" className="w-full" disabled={busy}>
          {busy ? "Registering…" : "Register"}
        </Button>
      </div>
    </form>
  );
}

function Identify({ busy, onSubmit, onForgot }: { busy: boolean; onSubmit: (v: string) => void; onForgot: () => void }) {
  const [value, setValue] = useState("");
  return (
    <div className="mx-auto max-w-xl">
      <div className="rounded-[28px] border border-border bg-surface p-7 text-center shadow-float sm:p-10">
        <span className="mx-auto inline-flex size-16 items-center justify-center rounded-3xl bg-brand text-brand-ink shadow-card">
          <UserRound className="size-8" aria-hidden />
        </span>
        <h1 className="mt-5 text-3xl font-bold tracking-tight sm:text-4xl">Welcome!</h1>
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
            className="h-16 w-full rounded-2xl border-2 border-border bg-surface-2 px-5 text-center font-mono text-2xl tracking-wider transition-colors placeholder:text-subtle focus:border-brand focus:bg-surface focus:ring-4 focus:ring-[var(--ring)] focus:outline-none"
          />
          <Button size="lg" className="h-14 w-full text-lg" disabled={busy || !value.trim()}>
            {busy ? "Checking…" : "Continue"}
          </Button>
        </form>
        <div className="my-7 flex items-center gap-3 text-sm text-subtle">
          <span className="h-px flex-1 bg-border" /> or <span className="h-px flex-1 bg-border" />
        </div>
        <Button variant="soft" size="lg" className="h-14 w-full text-lg" onClick={onForgot}>
          <CircleHelp /> I don&apos;t know my number
        </Button>
      </div>
      <p className="mt-6 flex items-center justify-center gap-2 text-sm text-muted">
        <ShieldCheck className="size-4 text-success" aria-hidden /> Your answers are saved on this computer as you go.
      </p>
    </div>
  );
}

function StudentGrid({ students, onPick }: { students: StudentCard[]; onPick: (s: StudentCard) => void }) {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
      {students.map((s) => (
        <button
          key={s.id}
          onClick={() => onPick(s)}
          className="group flex flex-col items-center gap-3 rounded-3xl border-2 border-border bg-surface p-5 text-center shadow-card transition-all hover:-translate-y-0.5 hover:border-brand focus:border-brand focus:outline-none"
        >
          <Avatar src={s.photo_url} name={s.name} size={104} />
          <span className="text-base leading-snug font-bold">{s.name}</span>
          <span className="rounded-full bg-surface-2 px-2.5 py-0.5 text-xs font-medium text-muted">{s.class_name}</span>
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
    <Panel icon={UsersRound} title="Which class are you in?" subtitle="Tap your class.">
      {err ? <Alert tone="danger">{err}</Alert> : null}
      {!classes && !err ? <p className="text-center text-muted">Loading classes…</p> : null}
      <div className="space-y-8">
        {sections.map((sec) => (
          <div key={sec}>
            <p className="mb-3 text-sm font-semibold tracking-wide text-muted uppercase">{sec}</p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {(classes ?? [])
                .filter((c) => c.section === sec)
                .map((c) => (
                  <button
                    key={c.id}
                    onClick={() => onPick(c)}
                    className="h-20 rounded-2xl border-2 border-border bg-surface text-lg font-bold shadow-card transition-all hover:-translate-y-0.5 hover:border-brand hover:text-brand focus:border-brand focus:outline-none"
                  >
                    {c.name}
                  </button>
                ))}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-10 text-center">
        <Button variant="secondary" size="lg" onClick={onBack}>
          <ArrowLeft /> Back
        </Button>
      </div>
    </Panel>
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
    <Panel icon={Search} title={`${cls.name}: find your name`} subtitle="Type the first few letters of your name, then tap your picture.">
      <div className="relative mx-auto max-w-xl">
        <Search className="pointer-events-none absolute top-1/2 left-5 size-5 -translate-y-1/2 text-subtle" aria-hidden />
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Start typing your name…"
          aria-label="Your name"
          className="h-16 w-full rounded-2xl border-2 border-border bg-surface pr-5 pl-14 text-xl shadow-card focus:border-brand focus:ring-4 focus:ring-[var(--ring)] focus:outline-none"
        />
      </div>
      {err ? (
        <div className="mx-auto mt-4 max-w-xl">
          <Alert tone="danger">{err}</Alert>
        </div>
      ) : null}
      <div className="mt-8">
        {students && students.length === 0 ? <p className="text-center text-muted">No match. Try fewer letters, or ask your supervisor.</p> : null}
        {students ? <StudentGrid students={students} onPick={onPick} /> : null}
      </div>
      <div className="mt-10 text-center">
        <Button variant="secondary" size="lg" onClick={onBack}>
          <ArrowLeft /> Choose another class
        </Button>
      </div>
    </Panel>
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
    <div className="mx-auto max-w-3xl">
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-[28px] border border-border bg-surface p-5 shadow-card sm:p-6">
        <div className="flex items-center gap-4">
          <Avatar src={session.student.photo_url} name={session.student.name} size={72} />
          <div>
            <p className="text-sm font-medium text-muted">Hello,</p>
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{session.student.first_name}</h1>
            <p className="text-sm text-muted">{session.student.class_name}</p>
          </div>
        </div>
        <Button variant="ghost" onClick={onLogout}>
          <LogOut /> This isn&apos;t me / Log out
        </Button>
      </div>

      <h2 className="mt-10 mb-4 text-lg font-bold">Your exams</h2>
      {exams.length === 0 ? (
        <Alert tone="info" title="No exam for you right now">
          If you think this is wrong, tell your supervisor.
        </Alert>
      ) : (
        <div className="space-y-4">
          {exams.map((e) => {
            const live = e.state === "live" && e.attempt_status !== "submitted";
            return (
              <div
                key={e.window_id}
                className={cn(
                  "flex flex-wrap items-center justify-between gap-5 rounded-3xl border-2 bg-surface p-5 shadow-card sm:p-6",
                  live ? "border-brand/50" : "border-border",
                )}
              >
                <div className="flex min-w-0 items-start gap-4">
                  <span className={cn("inline-flex size-14 shrink-0 items-center justify-center rounded-2xl", live ? "bg-brand text-brand-ink" : "bg-surface-2 text-muted")}>
                    <BookOpen className="size-7" aria-hidden />
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-brand">
                      {e.subject} · <span className="capitalize">{e.type}</span>
                      {e.is_makeup ? " · make-up" : ""}
                    </p>
                    <p className="text-xl font-bold tracking-tight">{e.title}</p>
                    <p className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
                      <span className="inline-flex items-center gap-1.5">
                        <ListChecks className="size-4" aria-hidden /> {e.question_count} questions
                      </span>
                      <span className="inline-flex items-center gap-1.5">
                        <Hourglass className="size-4" aria-hidden /> {e.duration_minutes} minutes
                      </span>
                      <span className="inline-flex items-center gap-1.5">
                        <Clock3 className="size-4" aria-hidden /> {when(e.starts_at)}–{when(e.ends_at)}
                      </span>
                    </p>
                  </div>
                </div>
                {e.attempt_status === "submitted" ? (
                  <span className="rounded-full bg-success-soft px-4 py-2 font-semibold text-success">Submitted ✓</span>
                ) : e.state === "live" ? (
                  <Button size="lg" className="h-14 min-w-36 text-lg" onClick={() => onPick(e)}>
                    <PlayCircle className="!size-5" /> {e.attempt_status === "in_progress" ? "Continue" : "Start"}
                  </Button>
                ) : (
                  <span className="flex items-center gap-2 rounded-full bg-warning-soft px-4 py-2 text-sm font-semibold text-warning">
                    <span className="size-2 animate-pulse rounded-full bg-current" aria-hidden />
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
            );
          })}
        </div>
      )}
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
  const facts = [
    { icon: BookOpen, label: "Subject", value: exam.subject },
    { icon: UsersRound, label: "Class", value: session.student.class_name },
    { icon: ListChecks, label: "Questions", value: String(exam.question_count) },
    { icon: Hourglass, label: "Time", value: `${exam.duration_minutes} minutes` },
  ];
  return (
    <div className="mx-auto max-w-3xl overflow-hidden rounded-[28px] border border-border bg-surface shadow-float">
      <div className="relative bg-[linear-gradient(135deg,var(--panel-1),var(--panel-3))] px-7 py-8 text-white sm:px-10">
        <div className="bg-grid pointer-events-none absolute inset-0 opacity-10" aria-hidden />
        <p className="relative text-sm font-semibold tracking-wide text-[var(--gold)] uppercase">Before you start</p>
        <h1 className="relative mt-1 text-3xl font-bold tracking-tight">{exam.title}</h1>
      </div>
      <div className="p-7 sm:p-10">
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {facts.map(({ icon: Icon, label, value }) => (
            <div key={label} className="rounded-2xl bg-surface-2 p-4">
              <dt className="flex items-center gap-1.5 text-xs font-semibold text-muted">
                <Icon className="size-3.5" aria-hidden /> {label}
              </dt>
              <dd className="mt-1 text-lg font-bold">{value}</dd>
            </div>
          ))}
        </dl>
        {exam.instructions ? (
          <div className="mt-6 rounded-2xl border border-border p-4">
            <p className="text-sm font-semibold">Instructions from your teacher</p>
            <p className="mt-1 whitespace-pre-wrap text-muted">{exam.instructions}</p>
          </div>
        ) : null}
        <ul className="mt-6 space-y-2.5 text-[15px]">
          {[
            "The timer starts when you press Start and keeps running, even if the internet goes off.",
            "Your answers are saved on this computer automatically.",
            "Stay on the exam screen. Leaving it is recorded.",
            "When time runs out, your exam is submitted for you.",
          ].map((t) => (
            <li key={t} className="flex gap-3">
              <ShieldCheck className="mt-0.5 size-5 shrink-0 text-success" aria-hidden />
              <span>{t}</span>
            </li>
          ))}
        </ul>
        <label
          className={cn(
            "mt-7 flex cursor-pointer items-start gap-4 rounded-2xl border-2 p-5 transition-colors",
            agreed ? "border-brand bg-brand-softer" : "border-border hover:border-border-strong",
          )}
        >
          <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="mt-0.5 size-6 accent-[var(--brand)]" />
          <span className="text-lg">
            I am <strong>{session.student.name}</strong>, and I will do this exam on my own.
          </span>
        </label>
        <div className="mt-7 flex flex-wrap gap-3">
          <Button size="lg" className="h-14 min-w-52 text-lg" disabled={!agreed || busy} onClick={onStart}>
            <PlayCircle className="!size-5" /> {busy ? "Starting…" : "Start exam"}
          </Button>
          <Button size="lg" variant="secondary" className="h-14" onClick={onBack}>
            Back
          </Button>
        </div>
      </div>
    </div>
  );
}
