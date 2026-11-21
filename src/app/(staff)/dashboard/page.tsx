import type { Metadata } from "next";
import Link from "next/link";
import { BookOpenCheck, CalendarClock, FilePlus2, UsersRound } from "lucide-react";
import {
  Badge,
  Card,
  CardHeader,
  EmptyState,
  LinkButton,
  cn,
} from "@/components/ui";
import { can, requireStaff } from "@/lib/auth";
import { formatDateTime, getStructure } from "@/lib/data";
import {
  STATUS_LABEL,
  TYPE_LABEL,
  WINDOW_LABEL,
  windowState,
} from "@/lib/labels";
import { getQuestionSettings, getUploadProgress } from "@/lib/onboarding";
import { createClient } from "@/lib/supabase/server";
import { NextSteps } from "@/components/next-steps";
import { NeedsAttention, type AttentionItem } from "./needs-attention";
import { SchoolOverview } from "./school-overview";
import { UploadChecklist } from "./upload-checklist";
import type { AssessmentStatus, AssessmentType } from "@/lib/types";

export const metadata: Metadata = { title: "Dashboard" };

export default async function Dashboard(props: PageProps<"/dashboard">) {
  const sp = await props.searchParams;
  const staff = await requireStaff();
  const s = await getStructure();
  const supabase = await createClient();

  const now = new Date();
  const dayStart = new Date(now.getTime() - 12 * 3600_000).toISOString();
  const weekAhead = new Date(now.getTime() + 7 * 24 * 3600_000).toISOString();

  const [settings, myProgress] = await Promise.all([
    getQuestionSettings(),
    getUploadProgress(s, staff.id),
  ]);
  const showChecklist =
    !staff.isSuperAdmin && (staff.role === "teacher" || myProgress.length > 0);

  const [requests, resumes] = staff.isAdmin
    ? await Promise.all([
        can(staff, "teachers.manage")
          ? supabase.from("teaching_assignments").select("id", { count: "exact", head: true }).eq("status", "requested")
          : Promise.resolve({ count: 0 }),
        supabase.from("resume_requests").select("id, window_id").eq("status", "pending").limit(50),
      ])
    : [{ count: 0 }, { data: [] as { id: string; window_id: string }[] }];
  const [assignments, mine, windows, pending] = await Promise.all([
    supabase
      .from("teaching_assignments")
      .select("id, subject_id, class_id, status")
      .eq("teacher_id", staff.id)
      .eq("session_id", s.currentSessionId ?? ""),
    supabase
      .from("assessments")
      .select("id, title, type, status, subject_id, year_id, updated_at")
      .eq("created_by", staff.id)
      .order("updated_at", { ascending: false })
      .limit(6),
    supabase
      .from("exam_windows")
      .select(
        "id, class_id, starts_at, ends_at, status, auto_start, assessments(title, type, subject_id)",
      )
      .gte("ends_at", dayStart)
      .lte("starts_at", weekAhead)
      .order("starts_at")
      .limit(20),
    staff.isAdmin && can(staff, "exam.approve")
      ? supabase
          .from("assessments")
          .select("id", { count: "exact", head: true })
          .eq("status", "pending_approval")
      : Promise.resolve({ count: 0 }),
  ]);

  // My tests that were flagged after approval, or sent back.
  const { data: attention } = staff.isSuperAdmin
    ? { data: [] }
    : await supabase
        .from("assessments")
        .select(
          "id, title, subject_id, status, review_note, flag_status, flag_category, flag_note, amending, corrections_submitted_at",
        )
        .eq("created_by", staff.id)
        .or("flag_status.eq.open,status.eq.changes_requested")
        .order("updated_at", { ascending: false })
        .limit(20);
  const attentionItems: AttentionItem[] = (attention ?? []).map((a) => ({
    id: a.id,
    title: a.title,
    subject: s.subjectById.get(a.subject_id)?.name ?? "",
    kind: a.flag_status === "open" ? "flag" : "back",
    category: a.flag_category,
    note: a.flag_status === "open" ? a.flag_note : a.review_note,
    amending: Boolean(a.amending),
    correctionsSent: Boolean(a.corrections_submitted_at),
  }));
  const approved = (assignments.data ?? []).filter(
    (a) => a.status === "approved",
  );
  type W = {
    id: string;
    class_id: string;
    starts_at: string;
    ends_at: string;
    status: string;
    auto_start: boolean;
    assessments: {
      title: string;
      type: AssessmentType;
      subject_id: string;
    } | null;
  };
  const upcoming = ((windows.data ?? []) as unknown as W[]).filter(
    (w) =>
      !staff.isAdmin ||
      staff.isSuperAdmin ||
      staff.sectionIds.includes(s.sectionOfClass(w.class_id)?.id ?? ""),
  );
  const liveNow = upcoming.filter((w) => windowState(w) === "live");
  const awaiting = upcoming.filter((w) => windowState(w) === "awaiting_start");
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", {
      hour: "numeric",
      hour12: false,
      timeZone: "Africa/Lagos",
    }).format(now),
  );
  const greeting =
    hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const firstName = staff.fullName
    .replace(/^(Mr|Mrs|Ms|Miss|Dr|Prof)\.?\s+/i, "")
    .split(" ")[0];

  return (
    <div className="space-y-8">
      {sp.done === "subjects" ? (
        <NextSteps
          title="Your subjects and classes are saved."
          steps={[
            {
              href: "/teach/questions/import",
              label: "Upload my questions",
              primary: true,
            },
            { href: "/teach/classes", label: "Change my subjects" },
          ]}
        >
          Classes nobody else teaches are usually ready straight away; any that
          need your Head of Section show as waiting, and we will email you when
          they decide. You do not have to wait: you can upload questions now.
        </NextSteps>
      ) : null}
      {sp.done === "corrected" ? (
        <NextSteps
          title="Your corrections were sent."
          steps={[
            {
              href: "/teach/assessments",
              label: "See my tests",
              primary: true,
            },
          ]}
        >
          Your Head of Section will accept them. Until then the approved version
          stays in use.
        </NextSteps>
      ) : null}
      <NeedsAttention items={attentionItems} />
      {sp.done === "submitted" ? (
        <NextSteps
          title="Your test was sent for approval."
          steps={[
            {
              href: "/teach/assessments/new",
              label: "Create another test",
              primary: true,
            },
            { href: "/teach/assessments", label: "See my tests" },
          ]}
        >
          Your Head of Section will review it and set the exam date. We will
          email you when it is approved or if changes are needed.
        </NextSteps>
      ) : null}
      {/* Header: who and when, the one thing happening now, and the main action. */}
      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div>
          <p className="text-sm text-muted">
            {s.currentTerm ? `${s.currentTerm.session_name} · ${s.currentTerm.name}` : "No current term set"}
          </p>
          <h1 className="mt-0.5 text-2xl font-semibold">
            {greeting}, {firstName}
          </h1>
        </div>
        {!staff.isSuperAdmin ? (
          <div className="flex flex-wrap gap-2">
            <LinkButton href="/teach/questions/import">Upload questions</LinkButton>
            <LinkButton href="/teach/questions" variant="secondary">
              Make a test from my questions
            </LinkButton>
          </div>
        ) : null}
      </header>

      {/* Only what needs doing: exams to start or watch, students to let back in, things to approve. */}
      {liveNow.length || awaiting.length || (pending.count ?? 0) > 0 || (requests.count ?? 0) > 0 || (resumes.data ?? []).length ? (
        <section aria-labelledby="needs-you" className="animate-enter overflow-hidden rounded-lg border border-brand/30 bg-surface shadow-sm">
          <h2 id="needs-you" className="flex items-center gap-2 border-b border-border bg-brand-soft/50 px-4 py-2.5 text-sm font-semibold sm:px-5">
            <span className="relative flex size-2.5" aria-hidden>
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-brand opacity-60 motion-reduce:hidden" />
              <span className="relative inline-flex size-2.5 rounded-full bg-brand" />
            </span>
            Needs you now
          </h2>
          <div className="stagger divide-y divide-border">
            {awaiting.length ? (
              <TodoRow
                tone="danger"
                text={`${awaiting.length} exam${awaiting.length === 1 ? " is" : "s are"} waiting for an administrator to press Start.`}
                href={staff.isAdmin ? `/admin/exams/${awaiting[0].id}` : undefined}
                action={staff.isAdmin && can(staff, "exam.start") ? "Start" : undefined}
                primary
              />
            ) : null}
            {(resumes.data ?? []).length ? (
              <TodoRow
                tone="danger"
                text={`${resumes.data!.length} student${resumes.data!.length === 1 ? " is" : "s are"} asking to continue an exam.`}
                href={`/admin/exams/${resumes.data![0].window_id}`}
                action="Respond"
                primary
              />
            ) : null}
            {liveNow.length ? (
              <TodoRow
                tone="success"
                text={`${liveNow.length} exam${liveNow.length === 1 ? " is" : "s are"} live now.`}
                href={staff.isAdmin ? `/admin/exams/${liveNow[0].id}` : undefined}
                action={staff.isAdmin ? "Watch" : undefined}
              />
            ) : null}
            {(pending.count ?? 0) > 0 ? (
              <TodoRow
                tone="warning"
                text={`${pending.count} test${pending.count === 1 ? " is" : "s are"} waiting for your review.`}
                href="/admin/approvals"
                action="Review"
              />
            ) : null}
            {(requests.count ?? 0) > 0 ? (
              <TodoRow
                tone="warning"
                text={`${requests.count} teaching request${requests.count === 1 ? " needs" : "s need"} your decision.`}
                href="/admin/assignments"
                action="Decide"
              />
            ) : null}
          </div>
        </section>
      ) : null}

      {showChecklist ? (
        <UploadChecklist
          rows={myProgress}
          s={s}
          fallbackDeadline={settings.defaultDeadline}
        />
      ) : null}

      {!staff.isAdmin && approved.length === 0 && !showChecklist ? (
        <Card>
          <EmptyState
            icon={UsersRound}
            title="You haven't been assigned any classes yet"
            action={
              <LinkButton href="/teach/classes">
                Tell us what you teach
              </LinkButton>
            }
          >
            Pick the subjects and classes you teach. Your Head of Section
            approves them, then you can set questions and see results.
          </EmptyState>
        </Card>
      ) : null}

      {staff.isSuperAdmin ? <SchoolOverview s={s} /> : null}

      {!staff.isSuperAdmin ? (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
          <Card>
            <CardHeader
              icon={CalendarClock}
              title="Exams this week"
              actions={
                staff.isAdmin ? (
                  <LinkButton href="/admin/exams" size="sm" variant="secondary">
                    Open monitor
                  </LinkButton>
                ) : undefined
              }
            />
            {upcoming.length === 0 ? (
              <EmptyState icon={CalendarClock} title="Nothing scheduled">
                Approved tests appear here once they have a date.
              </EmptyState>
            ) : (
              <ul className="divide-y divide-border">
                {upcoming.map((w) => {
                  const state = windowState(w);
                  const [label, tone] = WINDOW_LABEL[state];
                  const d = new Date(w.starts_at);
                  const inner = (
                    <>
                      <span className="flex w-11 shrink-0 flex-col items-center text-center text-muted">
                        <span className="text-xs">
                          {d.toLocaleDateString("en-NG", {
                            weekday: "short",
                            timeZone: "Africa/Lagos",
                          })}
                        </span>
                        <span className="text-lg leading-tight font-semibold text-text tabular-nums">
                          {d.toLocaleDateString("en-NG", {
                            day: "numeric",
                            timeZone: "Africa/Lagos",
                          })}
                        </span>
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">
                          {w.assessments?.title}
                        </span>
                        <span className="block truncate text-sm text-muted">
                          {s.className(w.class_id)} ·{" "}
                          {
                            s.subjectById.get(w.assessments?.subject_id ?? "")
                              ?.name
                          }{" "}
                          · {TYPE_LABEL[w.assessments?.type ?? "test"]} ·{" "}
                          {formatDateTime(w.starts_at).split(", ").pop()}
                        </span>
                      </span>
                      <Badge tone={tone} dot={state === "live"}>
                        {label}
                      </Badge>
                    </>
                  );
                  return (
                    <li key={w.id}>
                      {staff.isAdmin ? (
                        <Link
                          href={`/admin/exams/${w.id}`}
                          className="flex items-center gap-4 px-4 py-3 transition-colors hover:bg-surface-2 sm:px-5"
                        >
                          {inner}
                        </Link>
                      ) : (
                        <div className="flex items-center gap-4 px-4 py-3 sm:px-5">
                          {inner}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader
              icon={BookOpenCheck}
              title="My recent tests"
              actions={
                <LinkButton
                  href="/teach/assessments"
                  size="sm"
                  variant="secondary"
                >
                  See all
                </LinkButton>
              }
            />
            {(mine.data ?? []).length === 0 ? (
              <EmptyState
                icon={FilePlus2}
                title="No tests yet"
                action={
                  <LinkButton href="/teach/assessments/new" size="sm">
                    Create one
                  </LinkButton>
                }
              />
            ) : (
              <ul className="divide-y divide-border">
                {(mine.data ?? []).map((a) => {
                  const [label, tone] =
                    STATUS_LABEL[a.status as AssessmentStatus];
                  return (
                    <li key={a.id}>
                      <Link
                        href={`/teach/assessments/${a.id}`}
                        className="flex items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-surface-2 sm:px-5"
                      >
                        <span className="min-w-0">
                          <span className="block truncate font-medium">
                            {a.title}
                          </span>
                          <span className="block truncate text-sm text-muted">
                            {s.subjectById.get(a.subject_id)?.name} ·{" "}
                            {s.yearById.get(a.year_id)?.name} ·{" "}
                            {TYPE_LABEL[a.type as AssessmentType]}
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
        </div>
      ) : null}
    </div>
  );
}

function TodoRow({
  tone,
  text,
  href,
  action,
  primary,
}: {
  tone: "warning" | "success" | "info" | "danger";
  text: string;
  href?: string;
  action?: string;
  /** Urgent: shown with a filled button. */
  primary?: boolean;
}) {
  const dot = { warning: "bg-warning", success: "bg-success", info: "bg-info", danger: "bg-danger" }[tone];
  return (
    <div className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm sm:px-5">
      <span className={cn("size-2 shrink-0 rounded-full", dot)} aria-hidden />
      <span className={cn("min-w-0 flex-1", primary && "font-semibold")}>{text}</span>
      {href && action ? (
        <LinkButton href={href} size="sm" variant={primary ? "primary" : "secondary"}>
          {action}
        </LinkButton>
      ) : null}
    </div>
  );
}
