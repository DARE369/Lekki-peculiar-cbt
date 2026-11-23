import type { Metadata } from "next";
import { CalendarClock } from "lucide-react";
import Link from "next/link";
import { Alert, Card, EmptyState, LinkButton, PageHeader, cn } from "@/components/ui";
import { AutoRefresh } from "@/components/auto-refresh";
import { can, requireAdmin } from "@/lib/auth";
import { getRoundConfigs, getStructure } from "@/lib/data";
import { windowState } from "@/lib/labels";
import { createClient } from "@/lib/supabase/server";
import type { AssessmentType } from "@/lib/types";
import { ExamBulkTable } from "./exam-bulk-table";
import { ExamControls } from "./exam-controls";
import { GroupToggle, NeedsDate, type GroupBy, type NeedsDateTest } from "./needs-date";
import { ResultsPolicy } from "@/components/results-policy";
import { getResultsOverride } from "@/lib/results-policy";
import { resumeCutoffIso } from "@/lib/resume";

export const metadata: Metadata = { title: "Exams & live monitor" };

const VIEWS = { today: "Today", upcoming: "Upcoming", past: "Past", drafts: "Needs a date" } as const;

export default async function ExamsPage(props: PageProps<"/admin/exams">) {
  const sp = await props.searchParams;
  const view = (typeof sp.view === "string" && sp.view in VIEWS ? sp.view : "today") as keyof typeof VIEWS;
  const staff = await requireAdmin();
  const s = await getStructure();
  const supabase = await createClient();

  const now = new Date();
  const lagosMidnight = new Date(now.getTime() + 3600_000);
  lagosMidnight.setUTCHours(0, 0, 0, 0);
  const dayStart = new Date(lagosMidnight.getTime() - 3600_000);
  const dayEnd = new Date(dayStart.getTime() + 24 * 3600_000);

  // Always fetch unscheduled count so we can badge the "Needs a date" tab.
  const [{ data: draftTests }, { data: existingWindows }] = await Promise.all([
    supabase
      .from("assessments")
      .select(
        "id, title, type, subject_id, created_by, year_id, round_id, sequence_label, question_count, duration_minutes, class_ids, staff:created_by(full_name), assessment_questions(count)",
      )
      .eq("status", "approved")
      .eq("term_id", s.currentTerm?.id ?? "")
      .order("created_at", { ascending: false })
      .limit(200),
    supabase.from("exam_windows").select("assessment_id").limit(1000),
  ]);
  const scheduledIds = new Set((existingWindows ?? []).map((w: { assessment_id: string }) => w.assessment_id));
  type DraftRow = Omit<NeedsDateTest, "pool" | "staff"> & { staff: { full_name: string } | null; assessment_questions: { count: number }[] | null };
  const unscheduled: NeedsDateTest[] = ((draftTests ?? []) as unknown as DraftRow[])
    .filter((t) => !scheduledIds.has(t.id))
    .map(({ assessment_questions, ...t }) => ({ ...t, pool: assessment_questions?.[0]?.count ?? 0 }));
  const draftsCount = unscheduled.length;

  type WindowRow = {
    id: string;
    class_id: string;
    starts_at: string;
    ends_at: string;
    status: string;
    auto_start: boolean;
    assessments: { id: string; title: string; type: AssessmentType; subject_id: string; created_by: string } | null;
  };

  if (view === "drafts") {
    const groupBy: GroupBy = sp.group === "year" ? "year" : "subject";
    const rounds = await getRoundConfigs();
    return (
      <div className="space-y-6">
        <PageHeader
          icon={CalendarClock}
          title="Exams & live monitor"
          description="Open an exam to start it, watch progress and handle problems."
        />
        <ViewTabs view={view} draftsCount={draftsCount} />
        {Number(sp.scheduled) > 0 ? (
          <Alert tone="success" title={`Scheduled ${Number(sp.scheduled)} class${Number(sp.scheduled) === 1 ? "" : "es"}.`}>
            {draftsCount === 0 ? "Every approved test now has a date. " : ""}
            <Link href="/admin/exams?view=upcoming" className="font-semibold underline">
              See them under Upcoming
            </Link>
            .
          </Alert>
        ) : null}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted">
            {draftsCount === 0
              ? "All approved tests have a date set."
              : `${draftsCount} approved test${draftsCount === 1 ? "" : "s"} still need${draftsCount === 1 ? "s" : ""} a date. Tests are dated automatically when the Exam calendar has dates for their round (Settings → Exam calendar).`}
          </p>
          {draftsCount > 0 ? <GroupToggle groupBy={groupBy} /> : null}
        </div>
        <NeedsDate tests={unscheduled} groupBy={groupBy} s={s} rounds={rounds} />
      </div>
    );
  }

  let rows: WindowRow[] = [];

  // Today / Upcoming / Past — same as before
  let q = supabase
    .from("exam_windows")
    .select("id, class_id, starts_at, ends_at, status, auto_start, assessments(id, title, type, subject_id, created_by)")
    .limit(200);
  if (view === "today") q = q.lt("starts_at", dayEnd.toISOString()).gt("ends_at", dayStart.toISOString()).order("starts_at");
  if (view === "upcoming") q = q.gte("starts_at", dayEnd.toISOString()).order("starts_at");
  if (view === "past") q = q.lt("ends_at", dayStart.toISOString()).order("starts_at", { ascending: false });
  const { data } = await q;
  rows = (data ?? []) as unknown as WindowRow[];
  const resultsOverride = await getResultsOverride();
  const waiting = view === "today" ? rows.filter((w) => windowState(w) === "awaiting_start") : [];
  const { data: resumeRows } = await supabase
    .from("resume_requests")
    .select("window_id, exam_windows!inner(ends_at)")
    .eq("status", "pending")
    .gt("exam_windows.ends_at", resumeCutoffIso())
    .limit(50);

  const emptyMessages = {
    today: "No exams today",
    upcoming: "No upcoming exams",
    past: "No past exams",
  };

  // Build plain lookup objects for the client component (functions can't cross the server/client boundary)
  const classNames: Record<string, string> = Object.fromEntries(s.classes.map((c) => [c.id, c.name]));
  const subjectNames: Record<string, string> = Object.fromEntries([...s.subjectById.entries()].map(([id, sub]) => [id, sub.name]));

  return (
    <div className="space-y-6">
      <PageHeader
        icon={CalendarClock}
        title="Exams & live monitor"
        description="Open an exam to start it, watch progress and handle problems."
        actions={view === "today" ? <AutoRefresh seconds={20} /> : undefined}
      />
      <ViewTabs view={view} draftsCount={draftsCount} />
      <ResultsPolicy value={resultsOverride} canChange={staff.isSuperAdmin} />
      {waiting.length ? (
        <div className="animate-enter">
          <Alert tone="danger" title={`${waiting.length} exam${waiting.length === 1 ? " is" : "s are"} waiting for you to press Start`}>
            Students can&apos;t begin until it is started.
            <span className="mt-2 flex flex-wrap gap-2">
              {waiting.slice(0, 6).map((w) => (
                <LinkButton key={w.id} href={`/admin/exams/${w.id}`} size="sm">
                  Start {w.assessments?.title ?? "exam"} · {classNames[w.class_id] ?? ""}
                </LinkButton>
              ))}
            </span>
          </Alert>
        </div>
      ) : null}
      {(resumeRows ?? []).length ? (
        <div className="animate-enter">
          <Alert tone="warning" title={`${resumeRows!.length} student${resumeRows!.length === 1 ? " is" : "s are"} asking to continue an exam`}>
            <Link href={`/admin/exams/${resumeRows![0].window_id}`} className="font-semibold underline">
              Open and respond
            </Link>
          </Alert>
        </div>
      ) : null}
      {view === "today" || view === "upcoming" ? (
        <ExamControls
          rows={rows}
          classNames={classNames}
          subjectNames={subjectNames}
          can={{ start: can(staff, "exam.start"), extend: can(staff, "exam.extend_time"), results: can(staff, "exam.start") || can(staff, "exam.approve") }}
          resultsOverride={resultsOverride}
        />
      ) : null}
      <Card>
        {rows.length === 0 ? (
          <EmptyState title={emptyMessages[view]}>
            {view === "today" ? "Check Upcoming for scheduled exams, or Needs a date for approved tests without a schedule." : null}
          </EmptyState>
        ) : (
          <ExamBulkTable rows={rows} classNames={classNames} subjectNames={subjectNames} />
        )}
      </Card>
    </div>
  );
}

function ViewTabs({ view, draftsCount }: { view: keyof typeof VIEWS; draftsCount: number }) {
  return (
    <div className="flex gap-1 rounded-lg border border-border bg-surface p-1 text-sm" role="tablist">
      {(Object.entries(VIEWS) as [keyof typeof VIEWS, string][]).map(([v, label]) => (
        <Link
          key={v}
          href={`/admin/exams?view=${v}`}
          className={cn("flex items-center gap-1.5 rounded-md px-4 py-1.5", v === view ? "bg-brand text-brand-ink" : "hover:bg-surface-2")}
        >
          {label}
          {v === "drafts" && draftsCount > 0 ? (
            <span className={cn("inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-bold tabular-nums", v === view ? "bg-white/20 text-brand-ink" : "bg-danger text-white")}>
              {draftsCount > 99 ? "99+" : draftsCount}
            </span>
          ) : null}
        </Link>
      ))}
    </div>
  );
}
