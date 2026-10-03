import type { Metadata } from "next";
import { CalendarClock } from "lucide-react";
import Link from "next/link";
import { Badge, Card, EmptyState, PageHeader, Table, Td, Th, cn } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/forms";
import { AutoRefresh } from "@/components/auto-refresh";
import { requireAdmin } from "@/lib/auth";
import { formatDateTime, getStructure } from "@/lib/data";
import { TYPE_LABEL, WINDOW_LABEL, windowState } from "@/lib/labels";
import { createClient } from "@/lib/supabase/server";
import type { AssessmentType } from "@/lib/types";
import { scheduleFromExamsPage } from "./actions";

export const metadata: Metadata = { title: "Exams & live monitor" };

const VIEWS = { today: "Today", upcoming: "Upcoming", past: "Past", drafts: "Needs a date" } as const;

export default async function ExamsPage(props: PageProps<"/admin/exams">) {
  const sp = await props.searchParams;
  const view = (typeof sp.view === "string" && sp.view in VIEWS ? sp.view : "today") as keyof typeof VIEWS;
  await requireAdmin();
  const s = await getStructure();
  const supabase = await createClient();

  const now = new Date();
  const lagosMidnight = new Date(now.getTime() + 3600_000);
  lagosMidnight.setUTCHours(0, 0, 0, 0);
  const dayStart = new Date(lagosMidnight.getTime() - 3600_000);
  const dayEnd = new Date(dayStart.getTime() + 24 * 3600_000);

  type WindowRow = {
    id: string;
    class_id: string;
    starts_at: string;
    ends_at: string;
    status: string;
    auto_start: boolean;
    assessments: { id: string; title: string; type: AssessmentType; subject_id: string; created_by: string } | null;
  };

  let rows: WindowRow[] = [];

  if (view === "drafts") {
    // Approved assessments that have no exam window at all
    const { data: draftTests } = await supabase
      .from("assessments")
      .select("id, title, type, subject_id, created_by, year_id, staff:created_by(full_name)")
      .eq("status", "approved")
      .eq("term_id", s.currentTerm?.id ?? "")
      .order("created_at", { ascending: false })
      .limit(200);

    // Which assessments already have windows?
    const { data: existingWindows } = await supabase
      .from("exam_windows")
      .select("assessment_id")
      .limit(1000);
    const scheduledIds = new Set((existingWindows ?? []).map((w: { assessment_id: string }) => w.assessment_id));

    type DraftTest = { id: string; title: string; type: AssessmentType; subject_id: string; created_by: string; year_id: string; staff: { full_name: string } | null };
    const unscheduled = ((draftTests ?? []) as unknown as DraftTest[]).filter((t) => !scheduledIds.has(t.id));

    return (
      <div className="space-y-6">
        <PageHeader
          icon={CalendarClock}
          title="Exams & live monitor"
          description="Open an exam to start it, watch progress and handle problems."
        />
        <ViewTabs view={view} />
        <Card>
          {unscheduled.length === 0 ? (
            <EmptyState title="All approved tests have a date set">
              Every approved test has been scheduled. Check Today or Upcoming.
            </EmptyState>
          ) : (
            <>
              <div className="border-b border-border px-5 py-3 text-sm text-muted">
                {unscheduled.length} approved test{unscheduled.length === 1 ? "" : "s"} still need{unscheduled.length === 1 ? "s" : ""} a date.
              </div>
              <ul className="divide-y divide-border">
                {unscheduled.map((t) => {
                  const year = s.yearById.get(t.year_id);
                  const classesForYear = s.classes.filter((c) => c.year_id === t.year_id && c.active);
                  return (
                    <li key={t.id} className="space-y-4 px-5 py-4">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <p className="font-semibold">{t.title}</p>
                          <p className="text-xs text-muted">
                            {s.subjectById.get(t.subject_id)?.name} · {TYPE_LABEL[t.type]} · {year?.name ?? "—"} · by {(t.staff as unknown as { full_name: string } | null)?.full_name ?? "—"}
                          </p>
                        </div>
                        <Badge tone="warning">No date set</Badge>
                      </div>
                      <ActionForm action={scheduleFromExamsPage} className="space-y-3 rounded-lg border border-border p-4">
                        <input type="hidden" name="assessment_id" value={t.id} />
                        <p className="text-sm font-medium">Set exam dates</p>
                        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                          {classesForYear.map((c) => (
                            <label key={c.id} className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm has-checked:border-brand has-checked:bg-brand-soft">
                              <input type="checkbox" name="class_id" value={c.id} className="accent-[var(--brand)]" />
                              {c.name}
                            </label>
                          ))}
                        </div>
                        <div className="grid gap-3 sm:grid-cols-2">
                          <div className="space-y-1">
                            <label className="text-xs font-medium text-muted">Opens (Lagos time)</label>
                            <input type="datetime-local" name="starts_all" className="h-9 w-full rounded-lg border border-border px-2 text-sm" />
                          </div>
                          <div className="space-y-1">
                            <label className="text-xs font-medium text-muted">Closes</label>
                            <input type="datetime-local" name="ends_all" className="h-9 w-full rounded-lg border border-border px-2 text-sm" />
                          </div>
                        </div>
                        <SubmitButton size="sm">Set date</SubmitButton>
                      </ActionForm>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </Card>
      </div>
    );
  }

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

  const emptyMessages = {
    today: "No exams today",
    upcoming: "No upcoming exams",
    past: "No past exams",
  };

  return (
    <div className="space-y-6">
      <PageHeader
        icon={CalendarClock}
        title="Exams & live monitor"
        description="Open an exam to start it, watch progress and handle problems."
        actions={view === "today" ? <AutoRefresh seconds={20} /> : undefined}
      />
      <ViewTabs view={view} />
      <Card>
        {rows.length === 0 ? (
          <EmptyState title={emptyMessages[view]}>
            {view === "today" ? "Check Upcoming for scheduled exams, or Needs a date for approved tests without a schedule." : null}
          </EmptyState>
        ) : (
          <Table stack>
            <thead>
              <tr>
                <Th>Exam</Th>
                <Th>Class</Th>
                <Th>Opens</Th>
                <Th>Closes</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((w) => {
                const [label, tone] = WINDOW_LABEL[windowState(w)];
                return (
                  <tr key={w.id} className="hover:bg-surface-2">
                    <Td>
                      <Link href={`/admin/exams/${w.id}`} className="font-medium text-brand hover:underline">
                        {w.assessments?.title}
                      </Link>
                      <span className="block text-xs text-muted">
                        {s.subjectById.get(w.assessments?.subject_id ?? "")?.name} · {TYPE_LABEL[w.assessments?.type ?? "test"]}
                      </span>
                    </Td>
                    <Td label="Class">{s.className(w.class_id)}</Td>
                    <Td label="Opens" className="text-sm whitespace-nowrap">{formatDateTime(w.starts_at)}</Td>
                    <Td label="Closes" className="text-sm whitespace-nowrap">{formatDateTime(w.ends_at)}</Td>
                    <Td label="Status">
                      <Badge tone={tone}>{label}</Badge>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}

function ViewTabs({ view }: { view: keyof typeof VIEWS }) {
  return (
    <div className="flex gap-1 rounded-lg border border-border bg-surface p-1 text-sm" role="tablist">
      {(Object.entries(VIEWS) as [keyof typeof VIEWS, string][]).map(([v, label]) => (
        <Link
          key={v}
          href={`/admin/exams?view=${v}`}
          className={cn("rounded-md px-4 py-1.5", v === view ? "bg-brand text-brand-ink" : "hover:bg-surface-2")}
        >
          {label}
        </Link>
      ))}
    </div>
  );
}
