"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAction } from "@/components/use-action";
import { Alert, Badge, Button, Card, Input } from "@/components/ui";
import { windowState } from "@/lib/labels";
import type { ExamWindowRow } from "./exam-bulk-table";
import { bulkExtraTime, bulkFocusPenalty, bulkResultsHidden, bulkWindowAction } from "./actions";

type Notice = { tone: "success" | "danger"; text: string };

/**
 * Quick controls for the exams in the list below, so nobody has to open each one: choose the classes (and,
 * if wanted, subjects) that are affected, then change what you need for all of them at once.
 */
export function ExamControls({
  rows,
  classNames,
  subjectNames,
  can,
  resultsOverride,
}: {
  rows: ExamWindowRow[];
  classNames: Record<string, string>;
  subjectNames: Record<string, string>;
  can: { start: boolean; extend: boolean; results: boolean };
  /** school-wide choice about results, which beats a per-exam one */
  resultsOverride: "hide" | "show" | null;
}) {
  const router = useRouter();
  const { pending, running, run } = useAction();
  const [off, setOff] = useState<Set<string>>(new Set()); // classes the user switched off
  const [offSubjects, setOffSubjects] = useState<Set<string>>(new Set());
  const [minutes, setMinutes] = useState("10");
  const [reason, setReason] = useState("");
  const [penalty, setPenalty] = useState("0");
  const [notice, setNotice] = useState<Notice | null>(null);

  const classes = useMemo(() => {
    const ids = [...new Set(rows.map((r) => r.class_id))];
    return ids.map((id) => ({ id, name: classNames[id] ?? "Class" })).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  }, [rows, classNames]);
  const subjects = useMemo(() => {
    const ids = [...new Set(rows.map((r) => r.assessments?.subject_id).filter(Boolean))] as string[];
    return ids.map((id) => ({ id, name: subjectNames[id] ?? "Subject" })).sort((a, b) => a.name.localeCompare(b.name));
  }, [rows, subjectNames]);

  const scoped = rows.filter((r) => !off.has(r.class_id) && !offSubjects.has(r.assessments?.subject_id ?? ""));
  const withState = scoped.map((r) => ({ r, s: windowState(r) }));
  const notClosed = withState.filter((x) => x.s !== "closed");
  const target = {
    extra: notClosed.map((x) => x.r.id),
    penalty: notClosed.map((x) => x.r.id),
    start: withState.filter((x) => x.s === "awaiting_start" || x.s === "scheduled").map((x) => x.r.id),
    pause: withState.filter((x) => x.s === "live").map((x) => x.r.id),
    resume: withState.filter((x) => x.s === "paused").map((x) => x.r.id),
    close: withState.filter((x) => x.s === "live" || x.s === "paused" || x.s === "awaiting_start").map((x) => x.r.id),
    tests: [...new Set(notClosed.map((x) => x.r.assessments?.id).filter(Boolean))] as string[],
  };

  if (rows.length === 0) return null;
  if (!can.start && !can.extend && !can.results) return null;

  const toggle = (set: Set<string>, setter: (s: Set<string>) => void, id: string) => {
    const n = new Set(set);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    setter(n);
  };
  const finish = (res: { ok: boolean; message?: string; error?: string } | null | undefined) => {
    setNotice(res?.ok ? { tone: "success", text: res.message ?? "Done." } : { tone: "danger", text: (res as { error?: string } | null)?.error ?? "That didn't work." });
    router.refresh();
  };
  const exams = (n: number) => `${n} exam${n === 1 ? "" : "s"}`;

  const chip = (checked: boolean, label: string, onChange: () => void) => (
    <label
      key={label}
      className="flex cursor-pointer items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-sm transition-colors has-checked:border-brand has-checked:bg-brand-soft"
    >
      <input type="checkbox" checked={checked} onChange={onChange} className="accent-[var(--brand)]" />
      {label}
    </label>
  );

  const tile = "flex flex-col gap-3 rounded-lg border border-border bg-surface p-4";
  const minutesNum = Number(minutes);

  return (
    <Card className="overflow-hidden">
      <details open className="group">
        <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2 border-b border-border bg-surface-2/50 px-4 py-3 sm:px-5">
          <span>
            <span className="text-[15px] font-semibold">Quick controls</span>
            <span className="ml-2 text-sm text-muted">Change these exams for several classes at once</span>
          </span>
          <Badge tone="brand">{exams(scoped.length)} selected</Badge>
        </summary>

        <div className="space-y-4 p-4 sm:p-5">
          <fieldset>
            <legend className="mb-1.5 flex w-full items-center justify-between text-sm font-medium">
              <span>Classes affected</span>
              <span className="flex gap-3 text-xs font-semibold text-brand">
                <button type="button" onClick={() => setOff(new Set())} className="hover:underline">
                  All
                </button>
                <button type="button" onClick={() => setOff(new Set(classes.map((c) => c.id)))} className="hover:underline">
                  None
                </button>
              </span>
            </legend>
            <div className="flex flex-wrap gap-1.5">{classes.map((c) => chip(!off.has(c.id), c.name, () => toggle(off, setOff, c.id)))}</div>
          </fieldset>

          {subjects.length > 1 ? (
            <details>
              <summary className="cursor-pointer text-sm font-medium text-brand">
                Narrow by subject{offSubjects.size ? ` (${subjects.length - offSubjects.size} of ${subjects.length})` : ""}
              </summary>
              <div className="mt-2 flex flex-wrap gap-1.5">{subjects.map((x) => chip(!offSubjects.has(x.id), x.name, () => toggle(offSubjects, setOffSubjects, x.id)))}</div>
            </details>
          ) : null}

          {notice ? <Alert tone={notice.tone}>{notice.text}</Alert> : null}

          <div className="grid gap-3 lg:grid-cols-2">
            {can.extend ? (
              <section className={tile} aria-labelledby="ctl-extra">
                <div>
                  <h3 id="ctl-extra" className="font-semibold">
                    Extra time
                  </h3>
                  <p className="text-sm text-muted">Adds minutes to every exam that hasn&apos;t closed. Students still writing get them straight away.</p>
                </div>
                <div className="flex flex-wrap items-end gap-2">
                  <label className="space-y-1">
                    <span className="block text-xs font-medium text-muted">Minutes</span>
                    <Input value={minutes} onChange={(e) => setMinutes(e.target.value)} inputMode="numeric" className="h-9 w-20" aria-label="Extra minutes" />
                  </label>
                  <label className="min-w-40 flex-1 space-y-1">
                    <span className="block text-xs font-medium text-muted">Reason (for the record)</span>
                    <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Power cut 10:20" className="h-9" aria-label="Reason for extra time" />
                  </label>
                </div>
                <Button
                  size="sm"
                  disabled={pending || !target.extra.length || !(minutesNum >= 1 && minutesNum <= 240) || !reason.trim()}
                  loading={running("extra")}
                  onClick={() => {
                    if (!window.confirm(`Add ${minutesNum} minutes to ${exams(target.extra.length)}?`)) return;
                    run("extra", async () => finish(await bulkExtraTime(target.extra, minutesNum, reason)));
                  }}
                >
                  Add {Number.isFinite(minutesNum) ? minutesNum : ""} minutes to {exams(target.extra.length)}
                </Button>
              </section>
            ) : null}

            {can.results ? (
              <section className={tile} aria-labelledby="ctl-results">
                <div>
                  <h3 id="ctl-results" className="font-semibold">
                    Results shown to students
                  </h3>
                  <p className="text-sm text-muted">
                    {resultsOverride
                      ? `Set school-wide to ${resultsOverride === "hide" ? "hidden" : "shown"} for every exam, which overrides this. Change it in the box above.`
                      : "When hidden, students see only a congratulations message after submitting. A test is shared by all its classes, so this changes it for every class sitting it."}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={pending || Boolean(resultsOverride) || !target.tests.length}
                    loading={running("show")}
                    onClick={() => run("show", async () => finish(await bulkResultsHidden(target.tests, false)))}
                  >
                    Show results ({target.tests.length} test{target.tests.length === 1 ? "" : "s"})
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={pending || Boolean(resultsOverride) || !target.tests.length}
                    loading={running("hide")}
                    onClick={() => run("hide", async () => finish(await bulkResultsHidden(target.tests, true)))}
                  >
                    Hide results ({target.tests.length} test{target.tests.length === 1 ? "" : "s"})
                  </Button>
                </div>
              </section>
            ) : null}

            {can.start ? (
              <section className={tile} aria-labelledby="ctl-status">
                <div>
                  <h3 id="ctl-status" className="font-semibold">
                    Start, pause or close
                  </h3>
                  <p className="text-sm text-muted">Pausing stops new students starting; those already writing carry on.</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {(
                    [
                      ["start", "Start", target.start, "primary"],
                      ["pause", "Pause new starts", target.pause, "secondary"],
                      ["resume", "Resume", target.resume, "secondary"],
                      ["close", "Close", target.close, "danger"],
                    ] as const
                  ).map(([action, label, ids, variant]) => (
                    <Button
                      key={action}
                      size="sm"
                      variant={variant}
                      disabled={pending || !ids.length}
                      loading={running(action)}
                      onClick={() => {
                        if (action === "close" && !window.confirm(`Close ${exams(ids.length)}? Students still writing are submitted.`)) return;
                        run(action, async () => finish(await bulkWindowAction(ids, action)));
                      }}
                    >
                      {label} ({ids.length})
                    </Button>
                  ))}
                </div>
              </section>
            ) : null}

            {can.start ? (
              <section className={tile} aria-labelledby="ctl-penalty">
                <div>
                  <h3 id="ctl-penalty" className="font-semibold">
                    Leaving the exam screen
                  </h3>
                  <p className="text-sm text-muted">Minutes a student waits after leaving the exam screen before they can continue. 0 turns it off.</p>
                </div>
                <div className="flex flex-wrap items-end gap-2">
                  <label className="space-y-1">
                    <span className="block text-xs font-medium text-muted">Minutes (0–60)</span>
                    <Input value={penalty} onChange={(e) => setPenalty(e.target.value)} inputMode="numeric" className="h-9 w-20" aria-label="Focus penalty minutes" />
                  </label>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={pending || !target.penalty.length || !(Number(penalty) >= 0 && Number(penalty) <= 60)}
                    loading={running("penalty")}
                    onClick={() => run("penalty", async () => finish(await bulkFocusPenalty(target.penalty, Number(penalty))))}
                  >
                    Apply to {exams(target.penalty.length)}
                  </Button>
                </div>
              </section>
            ) : null}
          </div>
        </div>
      </details>
    </Card>
  );
}
