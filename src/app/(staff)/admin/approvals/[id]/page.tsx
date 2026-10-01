import type { Metadata } from "next";
import { ClipboardCheck } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Alert, Badge, Card, CardHeader, Field, PageHeader, Textarea } from "@/components/ui";
import { can, requireAdmin } from "@/lib/auth";
import { formatDateTime, getStructure } from "@/lib/data";
import { STATUS_LABEL, TYPE_LABEL, WINDOW_LABEL, windowState } from "@/lib/labels";
import { createClient } from "@/lib/supabase/server";
import { DEFAULT_SETTINGS, type AssessmentSettings, type AssessmentStatus, type AssessmentType, type QuestionOption } from "@/lib/types";
import { reopenAssessment, reviewAssessment, scheduleClasses } from "../../actions";
import { ScheduleFields } from "../schedule-fields";

export const metadata: Metadata = { title: "Review" };

interface Q {
  id: string;
  body: string;
  options: QuestionOption[];
  answer: string;
  topic: string | null;
  image_url?: string | null;
}

export default async function ReviewPage(props: PageProps<"/admin/approvals/[id]">) {
  const { id } = await props.params;
  const staff = await requireAdmin();
  const s = await getStructure();
  const supabase = await createClient();
  const { data: a } = await supabase.from("assessments").select("*, staff:created_by(full_name)").eq("id", id).maybeSingle();
  if (!a) notFound();

  let questions: Q[];
  if (a.paper) {
    questions = a.paper.questions;
  } else {
    const { data } = await supabase
      .from("assessment_questions")
      .select("questions(id, body, options, answer, topic, image_url)")
      .eq("assessment_id", id)
      .order("position");
    questions = (data ?? []).map((r) => r.questions as unknown as Q);
  }
  const { data: windows } = await supabase.from("exam_windows").select("*").eq("assessment_id", id).order("starts_at");
  const settings: AssessmentSettings = { ...DEFAULT_SETTINGS, ...(a.settings ?? {}) };
  const yearClasses = s.classes.filter((c) => c.year_id === a.year_id && c.active);
  const scheduled = new Set((windows ?? []).map((w) => w.class_id as string));
  const preferred = new Set<string>(a.class_ids ?? []);
  const canApprove = can(staff, "exam.approve");
  const [statusLabel, statusTone] = STATUS_LABEL[a.status as AssessmentStatus];

  return (
    <div className="space-y-6">
      <PageHeader
        icon={ClipboardCheck}
        back={{ href: "/admin/approvals", label: "Approvals" }}
        title={
          <span className="flex flex-wrap items-center gap-3">
            {a.title} <Badge tone={statusTone}>{statusLabel}</Badge>
          </span>
        }
        description={`${s.subjectById.get(a.subject_id)?.name} · ${s.yearById.get(a.year_id)?.name} · ${TYPE_LABEL[a.type as AssessmentType]} by ${(a.staff as { full_name: string } | null)?.full_name}`}
      />

      <div className="grid gap-6 xl:grid-cols-[1fr_420px]">
        <Card>
          <CardHeader
            title={`Questions (${questions.length} in pool, ${a.question_count} per student)`}
            description="Correct answers are highlighted."
          />
          <ol className="divide-y divide-border">
            {questions.map((q, i) => (
              <li key={q.id} className="flex gap-4 px-5 py-3">
                <span className="w-6 shrink-0 text-sm text-muted tabular-nums">{i + 1}.</span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm whitespace-pre-wrap">{q.body}</p>
                  {q.image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={q.image_url} alt="" className="mt-2 max-h-40 rounded border border-border" />
                  ) : null}
                  <div className="mt-1 grid gap-x-4 text-xs text-muted sm:grid-cols-2">
                    {q.options.map((o) => (
                      <span key={o.key} className={o.key === q.answer ? "font-semibold text-success" : ""}>
                        {o.key}. {o.text}
                      </span>
                    ))}
                  </div>
                  {q.topic ? <p className="mt-1 text-xs text-muted">Topic: {q.topic}</p> : null}
                </div>
              </li>
            ))}
          </ol>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Settings" />
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 p-5 text-sm">
              <dt className="text-muted">Time</dt>
              <dd>{a.duration_minutes} minutes</dd>
              <dt className="text-muted">Shuffle</dt>
              <dd>
                {settings.shuffle_questions ? "Questions" : "—"}
                {settings.shuffle_options ? " + options" : ""}
              </dd>
              <dt className="text-muted">Must answer all</dt>
              <dd>{settings.require_all_answered ? "Yes" : "No"}</dd>
              <dt className="text-muted">Students see</dt>
              <dd>{{ none: "Nothing", score: "Score", full: "Score + corrections" }[settings.show_result]}</dd>
              <dt className="text-muted">Pass mark</dt>
              <dd>{settings.pass_mark}%</dd>
            </dl>
            {settings.instructions ? <p className="border-t border-border px-5 py-3 text-sm">{settings.instructions}</p> : null}
          </Card>

          {!canApprove ? (
            <Alert tone="warning">You don&apos;t have permission to approve or schedule exams. Ask the super admin.</Alert>
          ) : a.status === "pending_approval" ? (
            <Card>
              <CardHeader title="Approve and schedule" />
              <ActionForm action={reviewAssessment} className="space-y-5 p-5">
                <input type="hidden" name="id" value={a.id} />
                <ScheduleFields classes={yearClasses} scheduled={scheduled} preferred={preferred} />
                <Field label="Note to the teacher (required if asking for changes)">
                  <Textarea name="note" rows={2} />
                </Field>
                <div className="flex flex-wrap gap-2">
                  <SubmitButton name="decision" value="approve" confirm="Approve? The questions will be locked.">
                    Approve &amp; schedule
                  </SubmitButton>
                  <SubmitButton name="decision" value="changes" variant="secondary">
                    Ask for changes
                  </SubmitButton>
                </div>
              </ActionForm>
            </Card>
          ) : a.status === "approved" ? (
            <>
              <Card>
                <CardHeader title="Scheduled classes" />
                {(windows ?? []).length === 0 ? (
                  <p className="p-5 text-sm text-muted">None yet.</p>
                ) : (
                  <ul className="divide-y divide-border">
                    {(windows ?? []).map((w) => {
                      const [label, tone] = WINDOW_LABEL[windowState(w)];
                      return (
                        <li key={w.id}>
                          <Link href={`/admin/exams/${w.id}`} className="flex items-center justify-between px-5 py-3 text-sm hover:bg-surface-2">
                            <span>
                              <span className="font-medium">{s.className(w.class_id)}</span>
                              <span className="block text-xs text-muted">
                                {formatDateTime(w.starts_at)} → {formatDateTime(w.ends_at)}
                              </span>
                            </span>
                            <Badge tone={tone}>{label}</Badge>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </Card>
              <Card>
                <CardHeader title="Schedule (more) classes" />
                <ActionForm action={scheduleClasses} className="space-y-5 p-5">
                  <input type="hidden" name="id" value={a.id} />
                  <ScheduleFields classes={yearClasses} scheduled={scheduled} preferred={preferred} />
                  <SubmitButton>Save schedule</SubmitButton>
                </ActionForm>
              </Card>
              <Card>
                <CardHeader title="Send back for changes" description="Only possible before any student has started." />
                <ActionForm action={reopenAssessment} className="space-y-3 p-5">
                  <input type="hidden" name="id" value={a.id} />
                  <Textarea name="note" rows={2} placeholder="What needs changing?" required />
                  <SubmitButton variant="secondary" confirm="Unlock this test for editing? Its schedule will be removed.">
                    Send back
                  </SubmitButton>
                </ActionForm>
              </Card>
            </>
          ) : (
            <Alert tone="info">This test is {statusLabel.toLowerCase()}.</Alert>
          )}
        </div>
      </div>
    </div>
  );
}
