import type { Metadata } from "next";
import { CheckCircle2, Clock3, PenLine, Radio, UsersRound, WifiOff } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/forms";
import { AutoRefresh } from "@/components/auto-refresh";
import { Alert, Avatar, Badge, Card, CardHeader, Field, Input, LinkButton, PageHeader, Stat, Table, Td, Th, cn } from "@/components/ui";
import { can, requireAdmin } from "@/lib/auth";
import { formatDateTime, fullName, getStructure } from "@/lib/data";
import { TYPE_LABEL, WINDOW_LABEL, windowState } from "@/lib/labels";
import { signPhotos } from "@/lib/photos";
import { createClient } from "@/lib/supabase/server";
import { formatTime, isoToLagosLocal } from "@/lib/time";
import type { AssessmentType, WindowState } from "@/lib/types";
import { deleteWindow, extendTime, grantMakeup, setFocusPenalty, unlockRelogin, voidAttempt, windowAction } from "../../actions";
import { ResumePanel, type ApprovedResumeRequest, type PendingResumeRequest, type ResumableStudent } from "./resume-panel";

export const metadata: Metadata = { title: "Live monitor" };

interface Attempt {
  id: string;
  student_id: string;
  status: "in_progress" | "submitted" | "voided";
  is_makeup: boolean;
  login_method: string;
  terminal_id: string | null;
  started_at: string;
  deadline: string;
  submitted_at: string | null;
  submit_source: string | null;
  last_sync_at: string | null;
  late_sync: boolean;
  focus_losses: number;
  relogins: number;
  total_questions: number;
  score: number | null;
  max_score: number | null;
  voided_reason: string | null;
}

export default async function MonitorPage(props: PageProps<"/admin/exams/[id]">) {
  const { id } = await props.params;
  const staff = await requireAdmin();
  const s = await getStructure();
  const supabase = await createClient();
  await supabase.rpc("finalize_expired_attempts");

  const { data: w } = await supabase
    .from("exam_windows")
    .select("*, assessments(id, title, type, subject_id, question_count, duration_minutes)")
    .eq("id", id)
    .maybeSingle();
  if (!w) notFound();
  const a = w.assessments as { id: string; title: string; type: AssessmentType; subject_id: string; question_count: number; duration_minutes: number };
  const state: WindowState = windowState(w);

  const [{ data: classStudents }, { data: attemptsData }, { data: exceptions }, { data: terminals }, { data: resumeReqs }] = await Promise.all([
    supabase
      .from("students")
      .select("id, admission_no, first_name, last_name, other_names, photo_path")
      .eq("class_id", w.class_id)
      .eq("active", true)
      .order("last_name"),
    supabase.from("attempts").select("*").eq("window_id", id).order("started_at"),
    supabase.from("exam_exceptions").select("*").eq("window_id", id).order("created_at", { ascending: false }),
    supabase.from("lab_terminals").select("id, name"),
    supabase.from("resume_requests").select("id, student_id, status, extra_minutes, requested_at, approved_at").eq("window_id", id).order("requested_at", { ascending: false }),
  ]);
  const attempts = (attemptsData ?? []) as Attempt[];
  const liveAttemptIds = attempts.filter((t) => t.status === "in_progress").map((t) => t.id);
  const { data: answerRows } = liveAttemptIds.length
    ? await supabase.from("attempt_answers").select("attempt_id").in("attempt_id", liveAttemptIds).not("selected", "is", null)
    : { data: [] as { attempt_id: string }[] };
  const answered = new Map<string, number>();
  for (const r of answerRows ?? []) answered.set(r.attempt_id, (answered.get(r.attempt_id) ?? 0) + 1);

  // Roster = class students + anyone granted a make-up or who has an attempt here.
  const extraIds = [
    ...new Set([...(exceptions ?? []).map((e) => e.student_id as string), ...attempts.map((t) => t.student_id)]),
  ].filter((sid) => !(classStudents ?? []).some((c) => c.id === sid));
  const { data: extraStudents } = extraIds.length
    ? await supabase.from("students").select("id, admission_no, first_name, last_name, other_names, photo_path").in("id", extraIds)
    : { data: [] };
  const students = [...(classStudents ?? []), ...(extraStudents ?? [])];
  const photos = await signPhotos(students.map((x) => x.photo_path));
  const terminalName = new Map((terminals ?? []).map((t) => [t.id as string, t.name as string]));

  const now = new Date().getTime();
  const latest = new Map<string, Attempt>();
  for (const t of attempts) {
    const prev = latest.get(t.student_id);
    if (!prev || prev.status === "voided") latest.set(t.student_id, t);
  }
  const makeups = new Map<string, { opens_at: string; closes_at: string; consumed_at: string | null }>();
  for (const e of exceptions ?? []) if (e.kind === "makeup" && !makeups.has(e.student_id)) makeups.set(e.student_id, e);

  const counts = { writing: 0, submitted: 0, notStarted: 0, offline: 0, flagged: 0 };
  for (const st of students) {
    const t = latest.get(st.id);
    if (!t || t.status === "voided") counts.notStarted++;
    else if (t.status === "in_progress") {
      counts.writing++;
      if (!t.last_sync_at || now - Date.parse(t.last_sync_at) > 90_000) counts.offline++;
    } else counts.submitted++;
    if (t && (t.focus_losses > 2 || t.relogins > 0 || t.late_sync)) counts.flagged++;
  }

  const [stateLabel, stateTone] = WINDOW_LABEL[state];
  const canStart = can(staff, "exam.start");
  const notStartedStudents = students.filter((st) => {
    const t = latest.get(st.id);
    return !t || t.status === "voided";
  });

  // Resume panel data
  type ResumeReqRow = { id: string; student_id: string; status: string; extra_minutes: number; requested_at: string; approved_at: string | null };
  const resumeReqRows = (resumeReqs ?? []) as ResumeReqRow[];
  const resumeRequestedIds = new Set(resumeReqRows.filter((r) => r.status !== "rejected").map((r) => r.student_id));
  const resumableStudents: ResumableStudent[] = canStart
    ? students
        .filter((st) => {
          const t = latest.get(st.id);
          return t && t.status === "submitted" && !resumeRequestedIds.has(st.id);
        })
        .map((st) => {
          const t = latest.get(st.id)!;
          return { id: st.id, name: fullName(st), submittedAt: t.submitted_at };
        })
    : [];
  const pendingResumeRequests: PendingResumeRequest[] = resumeReqRows
    .filter((r) => r.status === "pending")
    .map((r) => {
      const st = students.find((x) => x.id === r.student_id);
      return { id: r.id, studentId: r.student_id, studentName: st ? fullName(st) : "Student", extraMinutes: r.extra_minutes, requestedAt: r.requested_at };
    });
  const approvedResumeRequests: ApprovedResumeRequest[] = resumeReqRows
    .filter((r) => r.status === "approved")
    .map((r) => {
      const st = students.find((x) => x.id === r.student_id);
      return { id: r.id, studentId: r.student_id, studentName: st ? fullName(st) : "Student", extraMinutes: r.extra_minutes, approvedAt: r.approved_at ?? "" };
    });

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Radio}
        back={{ href: "/admin/exams", label: "Exams" }}
        title={
          <span className="flex flex-wrap items-center gap-3">
            {a.title} <Badge tone={stateTone} className="text-sm">{stateLabel}</Badge>
          </span>
        }
        description={`${s.className(w.class_id)} · ${s.subjectById.get(a.subject_id)?.name} · ${TYPE_LABEL[a.type]} · ${a.question_count} questions · ${a.duration_minutes} min${w.extra_minutes ? ` (+${w.extra_minutes} min extra)` : ""}`}
        actions={
          <>
            <AutoRefresh seconds={10} />
            <LinkButton href={`/reports/assessment/${a.id}?class=${w.class_id}`} variant="secondary" size="sm">
              Results
            </LinkButton>
          </>
        }
      />

      <Card className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="text-sm">
            {state === "live" ? (
              <p className="mb-1 font-medium text-success">● Live — students in {s.className(w.class_id)} can start now.</p>
            ) : state === "awaiting_start" ? (
              <p className="mb-1 font-medium text-warning">Students are waiting. Press Start when everyone is seated.</p>
            ) : null}
            <p>
              <span className="text-muted">Window:</span> {formatDateTime(w.starts_at)} → {formatTime(w.ends_at)}
            </p>
            <p className="text-xs text-muted">
              {w.auto_start ? "Starts automatically at the opening time." : "Students can start only after you press Start."} Late starters
              get the full {a.duration_minutes} minutes; nobody can start after the closing time.
            </p>
          </div>
          {canStart ? (
            <div className="flex flex-wrap items-end gap-2">
              {state === "scheduled" || state === "awaiting_start" ? (
                <ActionForm action={windowAction}>
                  <input type="hidden" name="window_id" value={id} />
                  <input type="hidden" name="action" value="start" />
                  <SubmitButton size="lg" confirm="Start the exam now? Students will be able to begin immediately.">
                    ▶ Start exam now
                  </SubmitButton>
                </ActionForm>
              ) : null}
              {state === "live" ? (
                <>
                  <ActionForm action={windowAction}>
                    <input type="hidden" name="window_id" value={id} />
                    <input type="hidden" name="action" value="pause" />
                    <SubmitButton variant="secondary">Pause new starts</SubmitButton>
                  </ActionForm>
                  <ActionForm action={windowAction}>
                    <input type="hidden" name="window_id" value={id} />
                    <input type="hidden" name="action" value="close" />
                    <SubmitButton variant="danger" confirm="Close the exam? Nobody else will be able to start. Students already writing keep their time.">
                      Close
                    </SubmitButton>
                  </ActionForm>
                </>
              ) : null}
              {state === "paused" ? (
                <ActionForm action={windowAction}>
                  <input type="hidden" name="window_id" value={id} />
                  <input type="hidden" name="action" value="resume" />
                  <SubmitButton>Resume</SubmitButton>
                </ActionForm>
              ) : null}
              {state === "closed" ? (
                <ActionForm action={windowAction} className="flex items-end gap-2">
                  <input type="hidden" name="window_id" value={id} />
                  <input type="hidden" name="action" value="start" />
                  <Field label="Reopen until">
                    <Input type="datetime-local" name="ends_at" defaultValue={isoToLagosLocal(new Date(now + 3600_000))} className="w-52" />
                  </Field>
                  <SubmitButton variant="secondary" confirm="Reopen this exam for the whole class?">
                    Reopen
                  </SubmitButton>
                </ActionForm>
              ) : null}
            </div>
          ) : (
            <Alert tone="warning">You can watch, but you don&apos;t have permission to start or stop exams.</Alert>
          )}
        </div>
      </Card>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <Stat label="Students" value={students.length} icon={UsersRound} />
        <Stat label="Writing" value={counts.writing} icon={PenLine} tone={counts.writing ? "info" : undefined} />
        <Stat label="Submitted" value={counts.submitted} icon={CheckCircle2} tone={counts.submitted ? "success" : undefined} />
        <Stat label="Not started" value={counts.notStarted} icon={Clock3} tone={counts.notStarted && state !== "scheduled" ? "warning" : undefined} />
        <Stat
          label="Offline / flagged"
          icon={WifiOff}
          value={`${counts.offline} / ${counts.flagged}`}
          tone={counts.offline || counts.flagged ? "danger" : undefined}
          hint="Offline = no contact for 90s"
        />
      </div>

      <Card>
        <CardHeader title="Students" description="Open a row for actions: unlock another computer, extra time, void." />
        <Table stack>
          <thead>
            <tr>
              <Th>Student</Th>
              <Th>Status</Th>
              <Th>Progress</Th>
              <Th>Computer</Th>
              <Th>Flags</Th>
              <Th className="w-8" />
            </tr>
          </thead>
          <tbody>
            {students.map((st) => {
              const t = latest.get(st.id);
              const mk = makeups.get(st.id);
              const name = fullName(st);
              const offline = t?.status === "in_progress" && (!t.last_sync_at || now - Date.parse(t.last_sync_at) > 90_000);
              const left = t?.status === "in_progress" ? Math.max(0, Math.round((Date.parse(t.deadline) - now) / 60000)) : null;
              return (
                <tr key={st.id} className="align-top">
                  <Td>
                    <span className="flex items-center gap-3">
                      <Avatar src={st.photo_path ? photos.get(st.photo_path) : null} name={name} size={36} />
                      <span>
                        <span className="font-medium">{name}</span>
                        <span className="block font-mono text-xs text-muted">{st.admission_no}</span>
                      </span>
                    </span>
                  </Td>
                  <Td label="Status">
                    {!t || t.status === "voided" ? (
                      <>
                        <Badge tone={state === "live" ? "warning" : "neutral"}>{t?.status === "voided" ? "Voided" : "Not started"}</Badge>
                        {mk ? <span className="mt-1 block text-xs text-info">Make-up {formatDateTime(mk.opens_at)}</span> : null}
                      </>
                    ) : t.status === "in_progress" ? (
                      <>
                        <Badge tone={offline ? "danger" : "info"}>{offline ? "Writing · offline" : "Writing"}</Badge>
                        <span className="mt-1 block text-xs text-muted">{left} min left</span>
                      </>
                    ) : (
                      <>
                        <Badge tone="success">Submitted</Badge>
                        <span className="mt-1 block text-xs text-muted">
                          {formatTime(t.submitted_at)}
                          {t.submit_source === "timeout" ? " · time up" : t.submit_source === "auto_finalize" ? " · auto" : ""}
                        </span>
                      </>
                    )}
                  </Td>
                  <Td label="Progress" className="tabular-nums">
                    {t?.status === "in_progress" ? (
                      <span>
                        {answered.get(t.id) ?? 0}/{t.total_questions}
                        <span className="mt-1 block h-1.5 w-24 overflow-hidden rounded bg-surface-2">
                          <span
                            className="block h-full bg-brand"
                            style={{ width: `${((answered.get(t.id) ?? 0) / Math.max(1, t.total_questions)) * 100}%` }}
                          />
                        </span>
                      </span>
                    ) : t?.status === "submitted" ? (
                      <span className="font-medium">
                        {Number(t.score)}/{Number(t.max_score)}
                      </span>
                    ) : (
                      "—"
                    )}
                  </Td>
                  <Td label="Computer" className="text-xs">
                    {t?.terminal_id ? terminalName.get(t.terminal_id) : "—"}
                    {t?.last_sync_at ? <span className="block text-muted">seen {formatTime(t.last_sync_at)}</span> : null}
                  </Td>
                  <Td label="Flags">
                    <span className="flex flex-wrap gap-1">
                      {t?.is_makeup ? <Badge tone="info">Make-up</Badge> : null}
                      {t?.login_method === "name_search" ? <Badge>Name login</Badge> : null}
                      {t && t.relogins > 0 ? <Badge tone="danger">Re-login ×{t.relogins}</Badge> : null}
                      {t && t.focus_losses > 0 ? <Badge tone={t.focus_losses > 2 ? "danger" : "warning"}>Left screen ×{t.focus_losses}</Badge> : null}
                      {t?.late_sync ? <Badge tone="warning">Late upload</Badge> : null}
                    </span>
                  </Td>
                  <Td className="cell-actions">
                    <details className="relative">
                      <summary className="cursor-pointer list-none rounded px-2 py-1 text-muted hover:bg-surface-2 max-md:border max-md:border-border max-md:text-center max-md:text-sm max-md:font-semibold" aria-label="Actions">
                        <span className="md:hidden">Actions</span><span className="max-md:hidden">⋯</span>
                      </summary>
                      <div className="absolute right-0 z-10 mt-1 w-80 space-y-4 rounded-xl border border-border bg-surface p-4 shadow-lg max-md:static max-md:w-full max-md:shadow-none">
                        {t?.status === "in_progress" && can(staff, "attempt.unlock") ? (
                          <ActionForm action={unlockRelogin} className="space-y-2">
                            <input type="hidden" name="window_id" value={id} />
                            <input type="hidden" name="student_id" value={st.id} />
                            <p className="text-sm font-medium">Move to another computer</p>
                            <Input name="reason" placeholder="Reason, e.g. PC 14 froze" />
                            <SubmitButton size="sm" variant="secondary">
                              Unlock re-login
                            </SubmitButton>
                          </ActionForm>
                        ) : null}
                        {t?.status === "in_progress" && can(staff, "exam.extend_time") ? (
                          <ActionForm action={extendTime} className="space-y-2">
                            <input type="hidden" name="window_id" value={id} />
                            <input type="hidden" name="student_id" value={st.id} />
                            <p className="text-sm font-medium">Extra time for {st.first_name}</p>
                            <div className="flex gap-2">
                              <Input name="minutes" type="number" min={1} max={240} defaultValue={10} className="w-20" />
                              <Input name="reason" placeholder="Reason" required />
                            </div>
                            <SubmitButton size="sm" variant="secondary">
                              Add time
                            </SubmitButton>
                          </ActionForm>
                        ) : null}
                        {t && t.status !== "voided" && can(staff, "attempt.void") ? (
                          <ActionForm action={voidAttempt} className="space-y-2">
                            <input type="hidden" name="window_id" value={id} />
                            <input type="hidden" name="attempt_id" value={t.id} />
                            <p className="text-sm font-medium text-danger">Void this attempt</p>
                            <Input name="reason" placeholder="Reason (required)" required />
                            <SubmitButton size="sm" variant="danger" confirm={`Void ${name}'s attempt? Their score will not count.`}>
                              Void
                            </SubmitButton>
                          </ActionForm>
                        ) : null}
                        {t?.status === "voided" ? <p className="text-xs text-muted">Voided: {t.voided_reason}</p> : null}
                        {!t || t.status === "voided" ? (
                          <p className="text-xs text-muted">Not started — use “Make-up” below to let them sit it later.</p>
                        ) : null}
                      </div>
                    </details>
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      </Card>

      {(resumableStudents.length > 0 || pendingResumeRequests.length > 0 || approvedResumeRequests.length > 0) && (
        <ResumePanel
          windowId={id}
          resumable={resumableStudents}
          pending={pendingResumeRequests}
          approved={approvedResumeRequests}
        />
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {canStart ? (
          <Card>
            <CardHeader
              title="Focus-leave penalty"
              description="Students who leave the exam screen face a countdown before continuing. Set 0 to disable."
            />
            <ActionForm action={setFocusPenalty} className="flex flex-wrap items-end gap-3 p-5">
              <input type="hidden" name="window_id" value={id} />
              <Field label="Penalty (minutes, 0 = off)">
                <Input name="minutes" type="number" min={0} max={60} defaultValue={w.focus_penalty_minutes ?? 0} className="w-24" />
              </Field>
              <SubmitButton variant="secondary">Save</SubmitButton>
            </ActionForm>
          </Card>
        ) : null}
        {can(staff, "exam.extend_time") && state !== "closed" ? (
          <Card>
            <CardHeader title="Extra time for everyone" description="E.g. after a power cut. Adds to every running attempt and the closing time." />
            <ActionForm action={extendTime} className="flex flex-wrap items-end gap-3 p-5">
              <input type="hidden" name="window_id" value={id} />
              <Field label="Minutes">
                <Input name="minutes" type="number" min={1} max={240} defaultValue={10} className="w-24" />
              </Field>
              <Field label="Reason" className="flex-1">
                <Input name="reason" required placeholder="Power outage 10:20–10:30" />
              </Field>
              <SubmitButton variant="secondary">Add to all</SubmitButton>
            </ActionForm>
          </Card>
        ) : null}

        <Card>
          <CardHeader
            title="Make-up exam"
            description={can(staff, "exam.grant_makeup") ? "For students who missed it. They get a fresh random paper." : "Needs the “Grant make-up exams” permission from the super admin."}
          />
          {can(staff, "exam.grant_makeup") ? (
            notStartedStudents.length === 0 ? (
              <p className="p-5 text-sm text-muted">Everyone has started or submitted.</p>
            ) : (
              <ActionForm action={grantMakeup} className="space-y-4 p-5" resetOnSuccess>
                <input type="hidden" name="window_id" value={id} />
                <div className="grid max-h-48 grid-cols-1 gap-1 overflow-y-auto sm:grid-cols-2">
                  {notStartedStudents.map((st) => (
                    <label key={st.id} className="flex items-center gap-2 text-sm">
                      <input type="checkbox" name="student_id" value={st.id} className="accent-[var(--brand)]" />
                      {fullName(st)}
                    </label>
                  ))}
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Opens">
                    <Input type="datetime-local" name="opens_at" required defaultValue={isoToLagosLocal(new Date(now))} />
                  </Field>
                  <Field label="Closes">
                    <Input type="datetime-local" name="closes_at" required defaultValue={isoToLagosLocal(new Date(now + 2 * 3600_000))} />
                  </Field>
                </div>
                <Field label="Reason">
                  <Input name="reason" required placeholder="Absent — sick" />
                </Field>
                <SubmitButton>Grant make-up</SubmitButton>
              </ActionForm>
            )
          ) : null}
        </Card>
      </div>

      {(exceptions ?? []).length ? (
        <Card>
          <CardHeader title="Exceptions granted" />
          <ul className="divide-y divide-border text-sm">
            {(exceptions ?? []).map((e) => {
              const st = students.find((x) => x.id === e.student_id);
              return (
                <li key={e.id} className="flex flex-wrap justify-between gap-2 px-5 py-2.5">
                  <span>
                    <strong>{st ? fullName(st) : "Student"}</strong> —{" "}
                    {e.kind === "makeup" ? `make-up ${formatDateTime(e.opens_at)}–${formatTime(e.closes_at)}` : e.kind === "extra_time" ? `+${e.extra_minutes} min` : "re-login unlocked"}{" "}
                    <span className="text-muted">({e.reason})</span>
                  </span>
                  <span className={cn("text-xs", e.consumed_at ? "text-muted" : "text-info")}>
                    {e.consumed_at ? `used ${formatTime(e.consumed_at)}` : e.kind === "extra_time" ? "" : "not used yet"}
                  </span>
                </li>
              );
            })}
          </ul>
        </Card>
      ) : null}

      {attempts.length === 0 && can(staff, "exam.approve") ? (
        <div className="flex flex-wrap gap-3">
          <LinkButton href={`/admin/approvals/${a.id}`} variant="secondary" size="sm">
            Change date / time
          </LinkButton>
          <form action={deleteWindow}>
            <input type="hidden" name="window_id" value={id} />
            <SubmitButton variant="ghost" size="sm" confirm="Remove this class from the schedule?">
              Remove from schedule
            </SubmitButton>
          </form>
        </div>
      ) : null}
      <p className="text-xs text-muted">
        <Link href="/admin/audit" className="underline">
          Audit log
        </Link>{" "}
        records every start, pause, extension, unlock and void.
      </p>
    </div>
  );
}
