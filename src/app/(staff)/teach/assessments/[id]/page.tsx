import type { Metadata } from "next";
import { BookOpenCheck } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/forms";
import {
  Alert,
  Badge,
  Card,
  CardHeader,
  EmptyState,
  LinkButton,
  PageHeader,
} from "@/components/ui";
import { NextSteps } from "@/components/next-steps";
import { flagLabel } from "@/lib/readiness";
import { requireStaff } from "@/lib/auth";
import { formatDateTime, getStructure, getRoundConfigs } from "@/lib/data";
import { STATUS_LABEL, TYPE_LABEL, WINDOW_LABEL, windowState } from "@/lib/labels";
import { roundOf } from "@/lib/rounds";
import { createClient } from "@/lib/supabase/server";
import { DEFAULT_SETTINGS, type AssessmentSettings, type AssessmentStatus, type AssessmentType, type QuestionOption } from "@/lib/types";
import {
  beginCorrection,
  cancelCorrection,
  deleteAssessment,
  duplicateAssessment,
  submitCorrections,
  updateAssessmentClasses,
  withdrawSubmission,
} from "../../actions";
import { SettingsPanel } from "./settings-panel";
import { SendForReview } from "./send-for-review";
import { ScheduleForm } from "./schedule-form";
import { AddQuestions, type PoolBank, type PoolQuestion } from "./add-questions";
import { TestQuestions } from "./test-questions";

export const metadata: Metadata = { title: "Test" };

interface Q {
  id: string;
  body: string;
  options: QuestionOption[];
  answer: string;
  topic: string | null;
}

export default async function AssessmentPage(props: PageProps<"/teach/assessments/[id]">) {
  const { id } = await props.params;
  const sp = await props.searchParams;
  const staff = await requireStaff();
  const [s, rounds] = await Promise.all([getStructure(), getRoundConfigs()]);
  const supabase = await createClient();
  const { data: a } = await supabase.from("assessments").select("*").eq("id", id).maybeSingle();
  if (!a) notFound();

  const settings: AssessmentSettings = { ...DEFAULT_SETTINGS, ...(a.settings ?? {}) };
  const amending = a.status === "approved" && Boolean(a.amending);
  const editable = (a.status === "draft" || a.status === "changes_requested" || amending) && (a.created_by === staff.id || staff.isAdmin);
  // The picker shows this paper's own round by default; other rounds only when asked for (deliberate reuse).
  const paperRound = roundOf(a, rounds);

  let selected: Q[] = [];
  if (a.paper && !amending) {
    selected = a.paper.questions as Q[];
  } else {
    const { data } = await supabase
      .from("assessment_questions")
      .select("position, questions(id, body, options, answer, topic)")
      .eq("assessment_id", id)
      .order("position");
    selected = (data ?? []).map((r) => r.questions as unknown as Q).filter(Boolean);
  }
  const selectedIds = new Set(selected.map((q) => q.id));

  // What can be added: every question for this subject and year that isn't in the test yet, grouped by bank.
  let pool: PoolQuestion[] = [];
  let poolBanks: PoolBank[] = [];
  if (editable) {
    type BankRow = { id: string; body: string; answer: string; topic: string | null; upload_id: string | null; round_id: string | null; created_at: string };
    const all: BankRow[] = [];
    for (let from = 0; from < 5000; from += 1000) {
      const { data } = await supabase
        .from("questions")
        .select("id, body, answer, topic, upload_id, round_id, created_at")
        .eq("subject_id", a.subject_id)
        .eq("archived", false)
        .or(`year_id.eq.${a.year_id},year_id.is.null`)
        .order("created_at", { ascending: true })
        .range(from, from + 999);
      all.push(...((data ?? []) as BankRow[]));
      if (!data || data.length < 1000) break;
    }
    const available = all.filter((q) => !selectedIds.has(q.id));
    const uploadIds = [...new Set(available.map((q) => q.upload_id).filter((x): x is string => Boolean(x)))];
    const labels = new Map<string, { label: string; round_id: string | null }>();
    for (let i = 0; i < uploadIds.length; i += 150) {
      const { data: ups } = await supabase.from("question_uploads").select("id, label, round_id").in("id", uploadIds.slice(i, i + 150));
      for (const u of ups ?? []) labels.set(u.id as string, { label: u.label as string, round_id: (u.round_id as string | null) ?? null });
    }
    const counts = new Map<string, { n: number; rounds: Set<string | null> }>();
    for (const q of available) {
      const key = q.upload_id ?? "none";
      if (!counts.has(key)) counts.set(key, { n: 0, rounds: new Set() });
      const c = counts.get(key)!;
      c.n += 1;
      c.rounds.add(q.round_id);
    }
    const roundName = (id: string | null) => (id ? rounds.find((r) => r.id === id)?.label ?? null : null);
    poolBanks = [...counts.entries()]
      .map(([id, c]) => {
        const roundId = id === "none" ? (c.rounds.size === 1 ? [...c.rounds][0] : null) : (labels.get(id)?.round_id ?? (c.rounds.size === 1 ? [...c.rounds][0] : null));
        return {
          id,
          label: id === "none" ? "Earlier questions not in a named bank" : (labels.get(id)?.label ?? "Bank"),
          round: roundName(roundId),
          count: c.n,
          sameRound: Boolean(paperRound && roundId === paperRound.id),
        };
      })
      .sort((x, y) => Number(y.sameRound) - Number(x.sameRound) || (x.id === "none" ? 1 : y.id === "none" ? -1 : x.label.localeCompare(y.label)));
    pool = available.map((q) => ({ id: q.id, body: q.body.slice(0, 240), answer: q.answer, topic: q.topic, bank: q.upload_id ?? "none" }));
  }
  const fromBank = typeof sp.bank === "string" ? sp.bank : "";
  const defaultBank = poolBanks.find((b) => b.id === fromBank)?.id ?? poolBanks[0]?.id ?? "";

  const [{ data: windows }, classesResult, assignedResult] = await Promise.all([
    supabase.from("exam_windows").select("id, class_id, starts_at, ends_at, status, auto_start").eq("assessment_id", id).order("starts_at"),
    // All active classes in this year (for the classes editor)
    Promise.resolve(s.classes.filter((c) => c.active && c.year_id === a.year_id)),
    // Teacher's approved teaching assignments for this subject (to gate class choices)
    staff.isAdmin || staff.isSuperAdmin
      ? Promise.resolve(null)
      : supabase.from("teaching_assignments").select("class_id").eq("teacher_id", staff.id).eq("subject_id", a.subject_id).eq("session_id", s.currentSessionId ?? "").eq("status", "approved"),
  ]);

  const allYearClasses = classesResult;
  const assignedClassIds = new Set<string>(
    staff.isAdmin || staff.isSuperAdmin
      ? allYearClasses.map((c) => c.id)
      : ((assignedResult as { data: { class_id: string }[] | null } | null)?.data ?? []).map((r) => r.class_id),
  );
  const editableClasses = allYearClasses.filter((c) => assignedClassIds.has(c.id));

  // A test is "live" once any exam window has started — editing classes and deleting are blocked then.
  const isLive = (windows ?? []).some((w) => new Date(w.starts_at) <= new Date());

  // Classes that still need scheduling (only relevant when approved)
  const scheduledClassIds = new Set((windows ?? []).map((w) => w.class_id));
  const unscheduledClassIds = a.status === "approved"
    ? (a.class_ids as string[] ?? []).filter((c) => !scheduledClassIds.has(c) && assignedClassIds.has(c))
    : [];

  const [statusLabel, statusTone] = STATUS_LABEL[a.status as AssessmentStatus];
  const enough = selected.length >= a.question_count;

  return (
    <div className="space-y-6">
      <PageHeader
        icon={BookOpenCheck}
        back={{ href: "/teach/assessments", label: "Tests & exams" }}
        title={
          <span className="flex flex-wrap items-center gap-3">
            {a.title}
            {a.sequence_label ? <Badge tone="neutral">{a.sequence_label}</Badge> : null}
            <Badge tone={statusTone}>{statusLabel}</Badge>
          </span>
        }
        description={`${s.subjectById.get(a.subject_id)?.name} · ${(a.class_ids ?? []).length ? (a.class_ids as string[]).map((c) => s.className(c)).join(", ") : s.yearById.get(a.year_id)?.name} · ${TYPE_LABEL[a.type as AssessmentType]} · ${a.question_count} questions · ${a.duration_minutes} minutes`}
        actions={
          <>
            {a.status === "approved" ? <LinkButton href={`/reports/assessment/${a.id}`}>Results</LinkButton> : null}
            <form action={duplicateAssessment}>
              <input type="hidden" name="id" value={a.id} />
              <SubmitButton variant="secondary">Duplicate</SubmitButton>
            </form>
            {!isLive && (a.created_by === staff.id || staff.isAdmin || staff.isSuperAdmin) ? (
              <form action={deleteAssessment}>
                <input type="hidden" name="id" value={a.id} />
                <SubmitButton variant="ghost" confirm="Delete this test? This can't be undone.">
                  Delete
                </SubmitButton>
              </form>
            ) : null}
          </>
        }
      />
      {sp.added ? (
        <NextSteps
          title={
            sp.from === "bank"
              ? `Test made from ${Number(sp.added)} question${Number(sp.added) === 1 ? "" : "s"}. Set the time, marks and instructions on the right; they save by themselves.`
              : `Added ${Number(sp.added)} question${Number(sp.added) === 1 ? "" : "s"} to this test.`
          }
          steps={[{ href: `/teach/questions/import?assessment=${a.id}`, label: "Add more questions" }]}
        >
          {a.status === "draft" || a.status === "rejected"
            ? enough
              ? "You have enough questions. Check them below, then press Send for review."
              : `This test needs ${a.question_count - selected.length} more question${a.question_count - selected.length === 1 ? "" : "s"}. Add some from a bank below, or upload more.`
            : null}
        </NextSteps>
      ) : null}

      {a.status === "changes_requested" && a.review_note ? (
        <Alert tone="danger" title="Your Head of Section asked for changes">
          {a.review_note}
        </Alert>
      ) : null}
      {a.status === "pending_approval" ? (
        <Alert tone="warning" title="Waiting for approval">
          Your Head of Section will review the questions and set the date and time for each class.
          {a.created_by === staff.id ? (
            <ActionForm action={withdrawSubmission} className="mt-2">
              <input type="hidden" name="id" value={a.id} />
              <SubmitButton size="sm" variant="secondary">
                Withdraw to make changes
              </SubmitButton>
            </ActionForm>
          ) : null}
        </Alert>
      ) : null}
      {a.status === "approved" && a.flag_status === "open" ? (
        <Alert tone="warning" title={amending ? "You are correcting this test" : "Approved, but it needs a second look"}>
          <strong>{flagLabel(a.flag_category)}</strong>
          {a.flag_note ? ` — ${a.flag_note}` : ""}
          {amending ? (
            <span className="mt-1 block">
              {a.corrections_submitted_at
                ? "You sent your corrections. Your Head of Section will accept them; until then the approved version stays in use."
                : "Change the questions below, then press Send corrections. The approved version stays in use until your Head of Section accepts them."}
            </span>
          ) : a.created_by === staff.id ? (
            <form action={beginCorrection} className="mt-2">
              <input type="hidden" name="id" value={a.id} />
              <SubmitButton size="sm">Correct this test</SubmitButton>
            </form>
          ) : null}
        </Alert>
      ) : a.status === "approved" ? (
        <Alert tone="success" title="Approved">
          The questions are locked. {a.review_note ? `Note from reviewer: ${a.review_note}` : ""}
        </Alert>
      ) : null}
      {typeof sp.error === "string" ? <Alert tone="danger">{sp.error}</Alert> : null}

      {amending ? (
        <Card>
          <CardHeader
            title="Done correcting?"
            description={enough ? "Send your corrections to your Head of Section." : `Add ${a.question_count - selected.length} more question${a.question_count - selected.length === 1 ? "" : "s"} first (you have ${selected.length} of ${a.question_count}).`}
            actions={
              <>
                <ActionForm action={submitCorrections}>
                  <input type="hidden" name="id" value={a.id} />
                  <SubmitButton pendingText="Sending…">Send corrections</SubmitButton>
                </ActionForm>
                <form action={cancelCorrection}>
                  <input type="hidden" name="id" value={a.id} />
                  <SubmitButton variant="ghost" confirm="Stop correcting? The approved version stays exactly as it was.">
                    Stop correcting
                  </SubmitButton>
                </form>
              </>
            }
          />
        </Card>
      ) : editable ? (
        <Card>
          <SendForReview
            id={a.id}
            summary={
              enough
                ? selected.length > a.question_count
                  ? `You have ${selected.length} questions for a ${a.question_count}-question test. Each student gets a random ${a.question_count} of them, which makes copying harder.`
                  : `You have exactly ${a.question_count} questions.`
                : `Add ${a.question_count - selected.length} more question${a.question_count - selected.length === 1 ? "" : "s"} (you have ${selected.length} of ${a.question_count}).`
            }
          />
        </Card>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
        <div className="space-y-6">
          <Card>
            <CardHeader
              title={`Questions (${selected.length})`}
              description={amending ? "Your working copy. The approved version stays in use until corrections are accepted." : a.paper ? "Frozen copy used for this exam." : "In the order you added them. Students see them shuffled if shuffling is on."}
              actions={
                editable ? (
                  <>
                    <LinkButton href={`/teach/questions/import?assessment=${a.id}`} size="sm">
                      Upload into this test
                    </LinkButton>
                    <LinkButton href={`/teach/questions/new?assessment=${a.id}&subject=${a.subject_id}`} size="sm" variant="secondary">
                      Write one
                    </LinkButton>
                  </>
                ) : null
              }
            />
            {selected.length === 0 ? (
              <EmptyState title="No questions yet">Upload a file, write questions, or pick from the bank below.</EmptyState>
            ) : (
              <TestQuestions assessmentId={a.id} questions={selected} editable={editable} />
            )}
          </Card>

          {editable ? (
            <Card id="add-questions">
              <CardHeader
                title="Add questions"
                description={
                  enough
                    ? "This test has enough questions. Adding more gives each student a random set."
                    : `${a.question_count - selected.length} more needed. Choose a bank, then tick questions, select all, or take some at random.`
                }
              />
              <AddQuestions assessmentId={a.id} banks={poolBanks} pool={pool} needed={Math.max(0, a.question_count - selected.length)} defaultBank={defaultBank} />
            </Card>
          ) : null}
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Settings" description={amending ? "Settings stay as approved while you correct the questions." : editable ? undefined : "Locked while submitted or approved."} />
            <SettingsPanel
              key={`${a.id}:${editable && !amending}`}
              values={{
                id: a.id,
                title: a.title,
                sequence_label: (a as { sequence_label?: string | null }).sequence_label ?? null,
                topic: (a as { topic?: string | null }).topic ?? null,
                type: a.type as AssessmentType,
                question_count: a.question_count,
                duration_minutes: a.duration_minutes,
                settings,
              }}
              rounds={rounds}
              subjectName={s.subjectById.get(a.subject_id)?.name ?? ""}
              editable={editable && !amending}
            />
          </Card>

          <Card>
            <CardHeader
              title="Classes"
              description={isLive ? "Locked — the test has already started." : "Which classes take this test."}
            />
            <ActionForm action={updateAssessmentClasses} className="p-5 space-y-3">
              <input type="hidden" name="id" value={a.id} />
              <fieldset disabled={isLive || (!editable && a.status !== "pending_approval" && a.status !== "approved")} className="space-y-2">
                {editableClasses.length === 0 ? (
                  <p className="text-sm text-muted">No classes assigned.</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {editableClasses.map((c) => (
                      <label
                        key={c.id}
                        className="flex min-h-10 cursor-pointer items-center gap-2 rounded-xl border-2 border-border px-3 text-sm font-semibold has-checked:border-brand has-checked:bg-brand-soft disabled:cursor-not-allowed"
                      >
                        <input
                          type="checkbox"
                          name="class_id"
                          value={c.id}
                          defaultChecked={(a.class_ids as string[] ?? []).includes(c.id)}
                          className="size-4 accent-[var(--brand)]"
                          disabled={isLive}
                        />
                        {c.name}
                      </label>
                    ))}
                  </div>
                )}
                {!isLive && editableClasses.length > 0 ? (
                  <SubmitButton size="sm" variant="secondary">Save classes</SubmitButton>
                ) : null}
              </fieldset>
            </ActionForm>
          </Card>

          <Card>
            <CardHeader title="Exam dates" description="Scheduled windows for this test." />
            {(windows ?? []).length === 0 ? (
              <p className="p-5 text-sm text-muted">Not scheduled yet.</p>
            ) : (
              <ul className="divide-y divide-border">
                {(windows ?? []).map((w) => {
                  const [label, tone] = WINDOW_LABEL[windowState(w)];
                  return (
                    <li key={w.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                      <span>
                        <span className="font-medium">{s.className(w.class_id)}</span>
                        <span className="block text-xs text-muted">{formatDateTime(w.starts_at)}</span>
                      </span>
                      {staff.isAdmin ? (
                        <Link href={`/admin/exams/${w.id}`}>
                          <Badge tone={tone}>{label}</Badge>
                        </Link>
                      ) : (
                        <Badge tone={tone}>{label}</Badge>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          {unscheduledClassIds.length > 0 ? (
            <Card>
              <CardHeader
                title="Schedule"
                description="Set the date and time for each unscheduled class."
              />
              <div className="p-5 space-y-4">
                {unscheduledClassIds.map((classId) => (
                  <ScheduleForm
                    key={classId}
                    assessmentId={a.id}
                    classId={classId}
                    className={s.className(classId)}
                  />
                ))}
              </div>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}
