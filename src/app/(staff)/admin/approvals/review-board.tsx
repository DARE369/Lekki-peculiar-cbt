"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Flag,
  OctagonAlert,
  Send,
  Undo2,
} from "lucide-react";
import { SubmitButton } from "@/components/forms";
import { Alert, Badge, Button, Card, Input, Select, cn } from "@/components/ui";
import { FLAG_CATEGORIES, flagLabel } from "@/lib/readiness";
import type { ReviewTest } from "@/lib/review-data";
import { TYPE_LABEL } from "@/lib/labels";
import type { AssessmentType } from "@/lib/types";
import {
  bulkReviewAction,
  settleFlag,
  type BulkReviewResult,
} from "../actions";

type Action = "none" | "approve" | "flag" | "send_back";
interface Decision {
  action: Action;
  category: string;
  note: string;
}
type View = "class" | "subject" | "teacher" | "type" | "readiness";

interface Names {
  subjects: Record<string, string>;
  years: Record<string, string>;
  classes: Record<string, string>;
  /** Class ids in display order (year level, then name). */
  classOrder: string[];
}

const VIEWS: [View, string][] = [
  ["class", "By class"],
  ["subject", "By subject"],
  ["teacher", "By teacher"],
  ["type", "By type"],
  ["readiness", "By readiness"],
];

const VERDICT: Record<string, [string, "success" | "warning" | "danger"]> = {
  ready: ["Ready", "success"],
  warnings: ["Has warnings", "warning"],
  blocked: ["Needs fixing", "danger"],
};

interface Group {
  key: string;
  title: string;
  subtitle?: string;
  tests: ReviewTest[];
}

function buildGroups(view: View, tests: ReviewTest[], n: Names): Group[] {
  const by = (
    keyOf: (t: ReviewTest) => string[],
    title: (k: string) => string,
    order?: string[],
  ): Group[] => {
    const map = new Map<string, ReviewTest[]>();
    for (const t of tests)
      for (const k of keyOf(t)) map.set(k, [...(map.get(k) ?? []), t]);
    const keys = order
      ? order.filter((k) => map.has(k))
      : [...map.keys()].sort((a, b) => title(a).localeCompare(title(b)));
    return keys.map((k) => ({ key: k, title: title(k), tests: map.get(k)! }));
  };
  if (view === "class")
    return by(
      (t) => t.classIds,
      (k) => n.classes[k] ?? "Class",
      n.classOrder,
    );
  if (view === "subject")
    return by(
      (t) => [t.subjectId],
      (k) => n.subjects[k] ?? "Subject",
    );
  if (view === "teacher")
    return by(
      (t) => [t.teacherId],
      (k) => tests.find((t) => t.teacherId === k)?.teacherName ?? "Teacher",
    );
  if (view === "type")
    return by(
      (t) => [t.type],
      (k) => TYPE_LABEL[k as AssessmentType] ?? k,
      ["test", "exam", "mock_test", "mock", "practice"],
    );
  const bucket = (t: ReviewTest) =>
    t.status === "changes_requested"
      ? "6back"
      : t.status === "approved"
        ? t.flag?.status === "open"
          ? "4flagged"
          : "5approved"
        : t.verdict === "blocked"
          ? "1blocked"
          : t.verdict === "warnings"
            ? "2warnings"
            : "3ready";
  const titles: Record<string, string> = {
    "1blocked": "Needs fixing — can't be approved yet",
    "2warnings": "Ready, with warnings to look at",
    "3ready": "Ready to approve",
    "4flagged": "Approved, flagged for a second look",
    "5approved": "Approved",
    "6back": "Sent back to the teacher",
  };
  return by(
    (t) => [bucket(t)],
    (k) => titles[k],
    Object.keys(titles),
  );
}

export function ReviewBoard({
  tests,
  names,
  canDecide,
}: {
  tests: ReviewTest[];
  names: Names;
  canDecide: boolean;
}) {
  const router = useRouter();
  const [view, setView] = useState<View>("class");
  const [scope, setScope] = useState<"todo" | "all">("todo");
  const [focus, setFocus] = useState("");
  const [decisions, setDecisions] = useState<Record<string, Decision>>(() =>
    Object.fromEntries(
      tests
        .filter((t) => t.status === "pending_approval")
        .map((t) => [
          t.id,
          {
            action: (canDecide && t.verdict === "ready"
              ? "approve"
              : "none") as Action,
            category: "",
            note: "",
          },
        ]),
    ),
  );
  const [step, setStep] = useState<"choose" | "confirm">("choose");
  const [showErrors, setShowErrors] = useState(false);
  const [results, setResults] = useState<BulkReviewResult[] | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const byId = useMemo(() => new Map(tests.map((t) => [t.id, t])), [tests]);
  const inScope = tests.filter((t) =>
    scope === "all"
      ? true
      : t.status === "pending_approval" || t.flag?.status === "open",
  );
  const groups = buildGroups(view, inScope, names);
  const shown = focus ? groups.filter((g) => g.key === focus) : groups;

  const pendingTests = tests.filter((t) => t.status === "pending_approval");
  const count = (f: (t: ReviewTest) => boolean) => tests.filter(f).length;
  const tiles: [string, number, string?][] = [
    ["To review", pendingTests.length],
    ["Ready", count((t) => t.verdict === "ready"), "text-success"],
    ["With warnings", count((t) => t.verdict === "warnings"), "text-warning"],
    ["Need fixing", count((t) => t.verdict === "blocked"), "text-danger"],
    ["Flagged, open", count((t) => t.flag?.status === "open"), "text-warning"],
    [
      "Approved, no date",
      count((t) => t.status === "approved" && t.windows.length === 0),
    ],
  ];

  const chosen = (a: Action) =>
    pendingTests.filter((t) => decisions[t.id]?.action === a);
  const approving = chosen("approve");
  const flagging = chosen("flag");
  const sendingBack = chosen("send_back");
  const later =
    pendingTests.length -
    approving.length -
    flagging.length -
    sendingBack.length;

  const set = (id: string, patch: Partial<Decision>) =>
    setDecisions((d) => ({ ...d, [id]: { ...d[id], ...patch } }));
  const problem = (t: ReviewTest): string | null => {
    const d = decisions[t.id];
    if (!d) return null;
    if (d.action === "flag" && !d.category)
      return "Choose a reason for the flag.";
    if (d.action === "send_back" && !d.note.trim())
      return "Say what the teacher needs to change.";
    if (
      (d.action === "approve" || d.action === "flag") &&
      t.verdict === "blocked"
    )
      return "This test can't be approved until it is fixed.";
    return null;
  };

  function review() {
    setShowErrors(true);
    const bad = pendingTests.find(
      (t) => decisions[t.id]?.action !== "none" && problem(t),
    );
    if (bad) {
      document
        .getElementById(`test-${bad.id}`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    setStep("confirm");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function submit() {
    setFailure(null);
    const items = pendingTests
      .filter((t) => decisions[t.id]?.action !== "none")
      .map((t) => ({
        id: t.id,
        action: decisions[t.id].action as "approve" | "flag" | "send_back",
        category: decisions[t.id].category || undefined,
        note: decisions[t.id].note || undefined,
      }));
    startTransition(async () => {
      const res = await bulkReviewAction(items);
      if ("error" in res) setFailure(res.error);
      else setResults(res.results);
    });
  }

  if (results) {
    const ok = results.filter((r) => r.ok);
    const bad = results.filter((r) => !r.ok);
    return (
      <div className="space-y-4">
        <Alert
          tone={bad.length ? "warning" : "success"}
          title={`${ok.length} test${ok.length === 1 ? "" : "s"} reviewed${bad.length ? `, ${bad.length} could not be` : ""}.`}
        >
          Teachers have been emailed what you decided.{" "}
          {bad.length ? "The ones below were left as they were." : ""}
        </Alert>
        {bad.length ? (
          <Card>
            <ul className="divide-y divide-border">
              {bad.map((r) => (
                <li key={r.id} className="px-5 py-3 text-sm">
                  <span className="font-medium">{byId.get(r.id)?.title}</span>
                  <span className="block text-danger">{r.error}</span>
                </li>
              ))}
            </ul>
          </Card>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button
            onClick={() => {
              setResults(null);
              setStep("choose");
              router.refresh();
            }}
          >
            Back to the list
          </Button>
          <Link
            href="/admin/exams"
            className="inline-flex h-10 items-center rounded-xl border border-border px-4 text-sm font-semibold hover:border-brand"
          >
            Set exam dates
          </Link>
        </div>
      </div>
    );
  }

  if (step === "confirm") {
    const line = (t: ReviewTest, extra?: string) => (
      <li key={t.id} className="px-5 py-2.5 text-sm">
        <span className="font-medium">{t.title}</span>{" "}
        <span className="text-muted">
          · {names.subjects[t.subjectId]} · {t.teacherName}
        </span>
        {extra ? (
          <span className="block text-xs text-muted">{extra}</span>
        ) : null}
      </li>
    );
    return (
      <div className="space-y-4">
        <Alert tone="info" title="Check before you finish">
          Teachers will each get one email. Approved tests are locked. Flagged
          tests are approved too, but the teacher is asked to correct them, and
          they can&apos;t start by themselves.
        </Alert>
        {[
          {
            title: `Approve (${approving.length})`,
            list: approving,
            extra: () => undefined,
            tone: "text-success",
          },
          {
            title: `Approve and flag (${flagging.length})`,
            list: flagging,
            extra: (t: ReviewTest) =>
              `${flagLabel(decisions[t.id].category)}${decisions[t.id].note ? ` — ${decisions[t.id].note}` : ""}`,
            tone: "text-warning",
          },
          {
            title: `Send back (${sendingBack.length})`,
            list: sendingBack,
            extra: (t: ReviewTest) => decisions[t.id].note,
            tone: "text-danger",
          },
        ]
          .filter((g) => g.list.length)
          .map((g) => (
            <Card key={g.title}>
              <p
                className={cn(
                  "border-b border-border px-5 py-3 font-semibold",
                  g.tone,
                )}
              >
                {g.title}
              </p>
              <ul className="divide-y divide-border">
                {g.list.map((t) => line(t, g.extra(t)))}
              </ul>
            </Card>
          ))}
        {later ? (
          <p className="text-sm text-muted">
            {later} test{later === 1 ? " is" : "s are"} being left for later.
          </p>
        ) : null}
        {failure ? <Alert tone="danger">{failure}</Alert> : null}
        <div className="flex flex-wrap gap-2">
          <Button onClick={submit} disabled={pending} size="lg">
            <Send aria-hidden />{" "}
            {pending
              ? "Working…"
              : `Confirm: ${approving.length + flagging.length} approved, ${sendingBack.length} sent back`}
          </Button>
          <Button
            variant="ghost"
            size="lg"
            onClick={() => setStep("choose")}
            disabled={pending}
          >
            <Undo2 aria-hidden /> Go back
          </Button>
        </div>
      </div>
    );
  }

  const selectedCount = approving.length + flagging.length + sendingBack.length;
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {tiles.map(([label, value, tone]) => (
          <div
            key={label}
            className="rounded-2xl border border-border bg-surface px-4 py-3"
          >
            <p className="text-xs font-semibold tracking-wide text-muted uppercase">
              {label}
            </p>
            <p className={cn("mt-1 text-2xl font-bold tabular-nums", tone)}>
              {value}
            </p>
          </div>
        ))}
      </div>

      <div className="space-y-3">
        <div
          className="flex flex-wrap gap-2"
          role="tablist"
          aria-label="Group tests"
        >
          {VIEWS.map(([v, label]) => (
            <button
              key={v}
              type="button"
              role="tab"
              aria-selected={view === v}
              onClick={() => {
                setView(v);
                setFocus("");
              }}
              className={cn(
                "rounded-full border px-3.5 py-1.5 text-sm font-semibold",
                view === v
                  ? "border-brand bg-brand text-white"
                  : "border-border hover:border-brand",
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Select
            value={focus}
            onChange={(e) => setFocus(e.target.value)}
            aria-label="Show one group"
            className="w-full sm:w-64"
          >
            <option value="">
              {
                {
                  class: "All classes",
                  subject: "All subjects",
                  teacher: "All teachers",
                  type: "All types",
                  readiness: "Everything",
                }[view]
              }
            </option>
            {groups.map((g) => (
              <option key={g.key} value={g.key}>
                {g.title} ({g.tests.length})
              </option>
            ))}
          </Select>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={scope === "all"}
              onChange={(e) => setScope(e.target.checked ? "all" : "todo")}
              className="size-4 accent-[var(--brand)]"
            />
            Also show approved and sent-back tests
          </label>
        </div>
      </div>

      {shown.length === 0 ? (
        <Card>
          <p className="p-8 text-center text-muted">
            Nothing to review here. You&apos;re all caught up.
          </p>
        </Card>
      ) : null}

      {shown.map((g) => {
        const gp = g.tests.filter((t) => t.status === "pending_approval");
        const ready = gp.filter((t) => t.verdict === "ready");
        return (
          <section
            key={g.key}
            aria-label={`Tests: ${g.title}`}
            className="space-y-0 overflow-hidden rounded-2xl border border-border bg-surface"
          >
            <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-surface-2/60 px-4 py-3 sm:px-5">
              <div>
                <h2 className="font-semibold">{g.title}</h2>
                <p className="text-xs text-muted">
                  {g.tests.length} test{g.tests.length === 1 ? "" : "s"}
                  {gp.length
                    ? ` · ${ready.length} ready · ${gp.filter((t) => t.verdict === "warnings").length} with warnings · ${gp.filter((t) => t.verdict === "blocked").length} need fixing`
                    : ""}
                </p>
              </div>
              {canDecide && ready.length ? (
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() =>
                      ready.forEach((t) => set(t.id, { action: "approve" }))
                    }
                  >
                    Approve all {ready.length} ready
                  </Button>
                </div>
              ) : null}
            </header>
            <ul className="divide-y divide-border">
              {g.tests.map((t) => (
                <TestRow
                  key={t.id}
                  t={t}
                  names={names}
                  decision={decisions[t.id]}
                  canDecide={canDecide}
                  onChange={(patch) => set(t.id, patch)}
                  error={
                    showErrors && decisions[t.id]?.action !== "none"
                      ? problem(t)
                      : null
                  }
                />
              ))}
            </ul>
          </section>
        );
      })}

      {canDecide && pendingTests.length ? (
        <div className="sticky bottom-3 z-10 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-surface p-3 pl-4 shadow-float">
          <p className="text-sm" aria-live="polite">
            <strong>{approving.length}</strong> approve ·{" "}
            <strong>{flagging.length}</strong> flag ·{" "}
            <strong>{sendingBack.length}</strong> send back ·{" "}
            <span className="text-muted">{later} for later</span>
          </p>
          <Button
            size="lg"
            onClick={review}
            disabled={selectedCount === 0}
            className="max-sm:w-full"
          >
            Review and finish
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function TestRow({
  t,
  names,
  decision,
  canDecide,
  onChange,
  error,
}: {
  t: ReviewTest;
  names: Names;
  decision?: Decision;
  canDecide: boolean;
  onChange: (patch: Partial<Decision>) => void;
  error: string | null;
}) {
  const pending = t.status === "pending_approval";
  const [verdictLabel, verdictTone] = t.verdict
    ? VERDICT[t.verdict]
    : ["", "success" as const];
  const warnings = t.issues.filter((i) => i.severity === "warn").length;
  const blockers = t.issues.filter((i) => i.severity === "block").length;
  const classesReady = t.live.filter((c) => c.ready).length;
  const scheduled = new Set(t.windows.map((w) => w.classId)).size;
  return (
    <li
      id={`test-${t.id}`}
      className={cn("px-4 py-4 sm:px-5", error && "bg-danger-soft/40")}
    >
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1">
          <Link
            href={`/admin/approvals/${t.id}`}
            className="font-semibold break-words hover:text-brand hover:underline"
          >
            {t.title}
          </Link>
          <p className="mt-0.5 text-sm text-muted">
            {names.subjects[t.subjectId]} · {names.years[t.yearId]} ·{" "}
            {TYPE_LABEL[t.type as AssessmentType] ?? t.type}
          </p>
          <p className="text-sm text-muted">
            {t.teacherName} · {t.questionCount} questions
            {t.poolSize > t.questionCount ? ` from ${t.poolSize}` : ""} ·{" "}
            {t.durationMinutes} min
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {pending && t.verdict ? (
            <Badge tone={verdictTone} dot>
              {verdictLabel}
            </Badge>
          ) : t.status === "approved" ? (
            <Badge tone="success">Approved</Badge>
          ) : (
            <Badge tone="danger">Sent back</Badge>
          )}
          {t.flag?.status === "open" ? (
            <Badge tone="warning">
              <Flag className="mr-1 size-3" aria-hidden /> Flagged
            </Badge>
          ) : null}
          {t.status === "approved" ? (
            <Badge tone={scheduled ? "info" : "neutral"}>
              {scheduled
                ? `Scheduled · ${scheduled} of ${t.classIds.length} classes`
                : "No date yet"}
            </Badge>
          ) : null}
        </div>
      </div>

      {t.flag?.status === "open" ? (
        <div className="mt-3 rounded-xl border border-warning/40 bg-warning-soft px-3 py-2.5 text-sm">
          <p className="font-semibold">
            {flagLabel(t.flag.category)}
            {t.flag.note ? (
              <span className="font-normal"> — {t.flag.note}</span>
            ) : null}
          </p>
          <p className="mt-0.5 text-xs text-muted">
            {t.flag.correctionsSubmittedAt
              ? "The teacher has sent corrections."
              : t.flag.amending
                ? "The teacher is correcting it now."
                : "Waiting for the teacher."}
          </p>
          {canDecide ? (
            <div className="mt-2 flex flex-wrap gap-2">
              {t.flag.correctionsSubmittedAt ? (
                <form action={settleFlag}>
                  <input type="hidden" name="id" value={t.id} />
                  <input type="hidden" name="decision" value="accept" />
                  <SubmitButton size="sm" pendingText="Accepting…">
                    Accept the corrections
                  </SubmitButton>
                </form>
              ) : null}
              <form action={settleFlag}>
                <input type="hidden" name="id" value={t.id} />
                <input type="hidden" name="decision" value="close" />
                <SubmitButton
                  size="sm"
                  variant="secondary"
                  pendingText="Closing…"
                  confirm="Close this flag? The test stays exactly as approved."
                >
                  Close the flag
                </SubmitButton>
              </form>
            </div>
          ) : null}
        </div>
      ) : null}
      {t.status === "changes_requested" && t.reviewNote ? (
        <p className="mt-2 text-sm text-danger">Sent back: {t.reviewNote}</p>
      ) : null}

      {pending || t.status === "approved" ? (
        <details className="group mt-3">
          <summary className="inline-flex cursor-pointer list-none items-center gap-1 text-sm font-semibold text-brand">
            <ChevronDown
              className="size-4 transition-transform group-open:rotate-180"
              aria-hidden
            />
            {pending
              ? blockers
                ? `${blockers} problem${blockers === 1 ? "" : "s"}${warnings ? `, ${warnings} warning${warnings === 1 ? "" : "s"}` : ""}`
                : warnings
                  ? `${warnings} warning${warnings === 1 ? "" : "s"}`
                  : "No problems found"
              : "Class readiness"}
            <span className="ml-1 font-normal text-muted">
              · {classesReady} of {t.live.length} classes ready
            </span>
          </summary>
          <div className="mt-2 space-y-3 text-sm">
            {t.issues.length ? (
              <ul className="space-y-1.5">
                {t.issues.map((i) => (
                  <li key={i.code} className="flex gap-2">
                    {i.severity === "block" ? (
                      <OctagonAlert
                        className="mt-0.5 size-4 shrink-0 text-danger"
                        aria-label="Problem"
                      />
                    ) : (
                      <AlertTriangle
                        className="mt-0.5 size-4 shrink-0 text-warning"
                        aria-label="Warning"
                      />
                    )}
                    <span>{i.message}</span>
                  </li>
                ))}
              </ul>
            ) : pending ? (
              <p className="flex items-center gap-2 text-success">
                <CheckCircle2 className="size-4" aria-hidden /> The questions
                look sound.
              </p>
            ) : null}
            <ul className="space-y-1">
              {t.live.map((c) => (
                <li key={c.classId} className="flex gap-2">
                  {c.ready ? (
                    <CheckCircle2
                      className="mt-0.5 size-4 shrink-0 text-success"
                      aria-label="Ready"
                    />
                  ) : (
                    <AlertTriangle
                      className="mt-0.5 size-4 shrink-0 text-warning"
                      aria-label="Not ready"
                    />
                  )}
                  <span>
                    <strong>{c.name}</strong>
                    {c.notes.length ? (
                      <span className="text-muted">
                        {" "}
                        — {c.notes.join(" · ")}
                      </span>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
            <Link
              href={`/admin/approvals/${t.id}`}
              className="inline-block font-semibold text-brand hover:underline"
            >
              {t.status === "approved"
                ? "Open the test and set dates →"
                : "Open the full test →"}
            </Link>
          </div>
        </details>
      ) : null}

      {pending && canDecide && decision ? (
        <div className="mt-3 space-y-2">
          <label
            className="block text-xs font-semibold tracking-wide text-muted uppercase"
            htmlFor={`d-${t.id}`}
          >
            Your decision
          </label>
          <Select
            id={`d-${t.id}`}
            value={decision.action}
            onChange={(e) => onChange({ action: e.target.value as Action })}
            className="w-full sm:w-80"
            aria-label={`Decision for ${t.title}`}
          >
            <option value="none">Decide later</option>
            <option value="approve" disabled={t.verdict === "blocked"}>
              Approve
            </option>
            <option value="flag" disabled={t.verdict === "blocked"}>
              Approve, but flag for a second look
            </option>
            <option value="send_back">Send back for changes</option>
          </Select>
          {decision.action === "flag" ? (
            <div className="grid gap-2 sm:grid-cols-[16rem_1fr]">
              <Select
                value={decision.category}
                onChange={(e) => onChange({ category: e.target.value })}
                aria-label={`Reason for flagging ${t.title}`}
              >
                <option value="">What is the issue?</option>
                {FLAG_CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </Select>
              <Input
                value={decision.note}
                onChange={(e) => onChange({ note: e.target.value })}
                placeholder="Note for the teacher (optional)"
                aria-label={`Note for ${t.title}`}
              />
            </div>
          ) : null}
          {decision.action === "send_back" ? (
            <Input
              value={decision.note}
              onChange={(e) => onChange({ note: e.target.value })}
              placeholder="What does the teacher need to change?"
              aria-label={`What to change in ${t.title}`}
            />
          ) : null}
          {error ? (
            <p className="text-sm font-semibold text-danger">{error}</p>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
