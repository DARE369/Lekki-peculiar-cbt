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
  Checkbox,
  EmptyState,
  Field,
  Input,
  LinkButton,
  PageHeader,
  Select,
  Textarea,
} from "@/components/ui";
import { NextSteps } from "@/components/next-steps";
import { flagLabel } from "@/lib/readiness";
import { requireStaff } from "@/lib/auth";
import { formatDateTime, getStructure } from "@/lib/data";
import { STATUS_LABEL, TYPE_LABEL, WINDOW_LABEL, windowState } from "@/lib/labels";
import { createClient } from "@/lib/supabase/server";
import { DEFAULT_SETTINGS, type AssessmentSettings, type AssessmentStatus, type AssessmentType, type QuestionOption } from "@/lib/types";
import {
  beginCorrection,
  cancelCorrection,
  deleteAssessment,
  duplicateAssessment,
  removeQuestionFromAssessment,
  submitCorrections,
  submitForApproval,
  updateAssessmentClasses,
  updateAssessmentSettings,
  withdrawSubmission,
} from "../../actions";
import { TopicField } from "./topic-field";
import { ScheduleForm } from "./schedule-form";
import { QuestionPicker } from "./question-picker";

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
  const s = await getStructure();
  const supabase = await createClient();
  const { data: a } = await supabase.from("assessments").select("*").eq("id", id).maybeSingle();
  if (!a) notFound();

  const settings: AssessmentSettings = { ...DEFAULT_SETTINGS, ...(a.settings ?? {}) };
  const amending = a.status === "approved" && Boolean(a.amending);
  const editable = (a.status === "draft" || a.status === "changes_requested" || amending) && (a.created_by === staff.id || staff.isAdmin);
  const topicFilter = typeof sp.topic === "string" ? sp.topic : "";

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

  let bank: Q[] = [];
  let topics: string[] = [];
  if (editable) {
    const { data } = await supabase
      .from("questions")
      .select("id, body, options, answer, topic, year_id")
      .eq("subject_id", a.subject_id)
      .eq("archived", false)
      .order("created_at", { ascending: false })
      .limit(500);
    const all = (data ?? []).filter((q) => !q.year_id || q.year_id === a.year_id) as (Q & { year_id: string | null })[];
    topics = [...new Set(all.map((q) => q.topic).filter((t): t is string => Boolean(t)))].sort();
    bank = all.filter((q) => !selectedIds.has(q.id) && (!topicFilter || q.topic === topicFilter));
  }

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
            {a.title} <Badge tone={statusTone}>{statusLabel}</Badge>
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
          title={`Added ${Number(sp.added)} question${Number(sp.added) === 1 ? "" : "s"} to this test.`}
          steps={[{ href: `/teach/questions/import?assessment=${a.id}`, label: "Add more questions" }]}
        >
          {a.status === "draft" || a.status === "rejected"
            ? enough
              ? "You have enough questions. Check them below, then press Submit for approval."
              : `This test needs ${a.question_count - selected.length} more question${a.question_count - selected.length === 1 ? "" : "s"}. Upload more, or pick some from your question bank below.`
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
          <ActionForm action={submitForApproval} className="p-5 space-y-4">
            <input type="hidden" name="id" value={a.id} />
            <div>
              <p className="text-base font-semibold">Ready to submit?</p>
              <p className="mt-0.5 text-sm text-muted">
                {enough
                  ? selected.length > a.question_count
                    ? `You have ${selected.length} questions for a ${a.question_count}-question test. Each student gets a random ${a.question_count} of them — this makes copying harder.`
                    : `You have exactly ${a.question_count} questions.`
                  : `Add ${a.question_count - selected.length} more question${a.question_count - selected.length === 1 ? "" : "s"} (you have ${selected.length} of ${a.question_count}).`}
              </p>
            </div>
            <SubmitButton pendingText="Submitting…" confirm="Submit for approval? You won't be able to edit it while it's being reviewed.">
              Submit for approval
            </SubmitButton>
          </ActionForm>
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
              <ol className="divide-y divide-border">
                {selected.map((q, i) => (
                  <li key={q.id} className="flex gap-4 px-5 py-3">
                    <span className="w-6 shrink-0 text-sm text-muted tabular-nums">{i + 1}.</span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm whitespace-pre-wrap">{q.body}</p>
                      <div className="mt-1 grid gap-x-4 text-xs text-muted sm:grid-cols-2">
                        {q.options.map((o) => (
                          <span key={o.key} className={o.key === q.answer ? "font-semibold text-success" : ""}>
                            {o.key}. {o.text}
                          </span>
                        ))}
                      </div>
                    </div>
                    {editable ? (
                      <div className="flex shrink-0 flex-col items-end gap-1.5">
                        <Link href={`/teach/questions/${q.id}?assessment=${a.id}`} className="text-xs font-semibold text-brand hover:underline">
                          Edit
                        </Link>
                        <form action={removeQuestionFromAssessment}>
                          <input type="hidden" name="assessment_id" value={a.id} />
                          <input type="hidden" name="question_id" value={q.id} />
                          <button className="text-xs text-muted hover:text-danger">Remove</button>
                        </form>
                      </div>
                    ) : null}
                  </li>
                ))}
              </ol>
            )}
          </Card>

          {editable ? (
            <Card>
              <CardHeader
                title="Add from the question bank"
                description={`${bank.length} available for ${s.subjectById.get(a.subject_id)?.name}`}
                actions={
                  topics.length ? (
                    <form className="flex gap-2">
                      <Select name="topic" defaultValue={topicFilter} className="h-8 w-44 text-xs">
                        <option value="">All topics</option>
                        {topics.map((t) => (
                          <option key={t}>{t}</option>
                        ))}
                      </Select>
                      <button className="h-8 rounded-lg border border-border px-3 text-xs">Filter</button>
                    </form>
                  ) : null
                }
              />
              {bank.length === 0 ? (
                <EmptyState title="Nothing else in the bank" />
              ) : (
                <QuestionPicker
                  assessmentId={a.id}
                  bank={bank}
                  needed={Math.max(0, a.question_count - selected.length)}
                />
              )}
            </Card>
          ) : null}
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Settings" description={amending ? "Settings stay as approved while you correct the questions." : editable ? undefined : "Locked while submitted or approved."} />
            <ActionForm action={updateAssessmentSettings} className="space-y-4 p-5">
              <input type="hidden" name="id" value={a.id} />
              <fieldset disabled={!editable || amending} className="space-y-4">
                <Field label="Title">
                  <Input name="title" defaultValue={a.title} required />
                </Field>
                <TopicField
                  defaultValue={(a as { topic?: string | null }).topic ?? ""}
                  subjectName={s.subjectById.get(a.subject_id)?.name ?? ""}
                  editable={editable && !amending}
                />
                <Field label="Type">
                  <Select name="type" defaultValue={a.type}>
                    <optgroup label="Live">
                      <option value="test">Test</option>
                      <option value="exam">Exam</option>
                    </optgroup>
                    <optgroup label="Mock">
                      <option value="mock_test">Test mock</option>
                      <option value="mock">Exam mock</option>
                    </optgroup>
                    {a.type === "practice" ? <option value="practice">Practice</option> : null}
                  </Select>
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Questions per student">
                    <Input name="question_count" type="number" min={1} max={200} defaultValue={a.question_count} />
                  </Field>
                  <Field label="Minutes">
                    <Input name="duration_minutes" type="number" min={1} max={600} defaultValue={a.duration_minutes} />
                  </Field>
                </div>
                <div className="space-y-3 rounded-lg bg-surface-2 p-3">
                  <Checkbox name="shuffle_questions" label="Shuffle question order" defaultChecked={settings.shuffle_questions} />
                  <Checkbox name="shuffle_options" label="Shuffle options (A–D)" defaultChecked={settings.shuffle_options} />
                  <Checkbox
                    name="require_all_answered"
                    label="Must answer every question before submitting"
                    hint="When time runs out the test submits anyway."
                    defaultChecked={settings.require_all_answered}
                  />
                  <Checkbox name="allow_flag" label="Allow flagging questions for review" defaultChecked={settings.allow_flag} />
                  <Checkbox name="allow_back" label="Allow going back to earlier questions" defaultChecked={settings.allow_back} />
                </div>
                <Field label="After submitting, students see">
                  <Select name="show_result" defaultValue={settings.show_result}>
                    <option value="none">Nothing (just “submitted”)</option>
                    <option value="score">Their score</option>
                    <option value="full">Score and corrections</option>
                  </Select>
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Pass mark (%)">
                    <Input name="pass_mark" type="number" min={0} max={100} defaultValue={settings.pass_mark} />
                  </Field>
                  <Field label="Marks per question">
                    <Input name="marks_per_question" type="number" min={1} max={10} defaultValue={settings.marks_per_question} />
                  </Field>
                </div>
                <Field label="Instructions for students" hint="Shown on the start screen.">
                  <Textarea name="instructions" rows={3} defaultValue={settings.instructions} placeholder="Answer all questions. Each question carries equal marks." />
                </Field>
                {editable ? <SubmitButton>Save settings</SubmitButton> : null}
              </fieldset>
            </ActionForm>
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
