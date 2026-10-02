import type { Metadata } from "next";
import { CalendarClock } from "lucide-react";
import Link from "next/link";
import { Badge, Card, EmptyState, PageHeader, Table, Td, Th, cn } from "@/components/ui";
import { AutoRefresh } from "@/components/auto-refresh";
import { requireAdmin } from "@/lib/auth";
import { formatDateTime, getStructure } from "@/lib/data";
import { TYPE_LABEL, WINDOW_LABEL, windowState } from "@/lib/labels";
import { createClient } from "@/lib/supabase/server";
import type { AssessmentType } from "@/lib/types";

export const metadata: Metadata = { title: "Exams" };

const VIEWS = { today: "Today", upcoming: "Upcoming", past: "Past" } as const;

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

  let q = supabase
    .from("exam_windows")
    .select("id, class_id, starts_at, ends_at, status, auto_start, assessments(id, title, type, subject_id)")
    .limit(200);
  if (view === "today") q = q.lt("starts_at", dayEnd.toISOString()).gt("ends_at", dayStart.toISOString()).order("starts_at");
  if (view === "upcoming") q = q.gte("starts_at", dayEnd.toISOString()).order("starts_at");
  if (view === "past") q = q.lt("ends_at", dayStart.toISOString()).order("starts_at", { ascending: false });
  const { data } = await q;

  type Row = {
    id: string;
    class_id: string;
    starts_at: string;
    ends_at: string;
    status: string;
    auto_start: boolean;
    assessments: { id: string; title: string; type: AssessmentType; subject_id: string } | null;
  };
  const rows = (data ?? []) as unknown as Row[];

  return (
    <div className="space-y-6">
      <PageHeader
        icon={CalendarClock}
        title="Exams & live monitor"
        description="Open an exam to start it, watch progress and handle problems."
        actions={view === "today" ? <AutoRefresh seconds={20} /> : undefined}
      />
      <div className="flex gap-1 rounded-lg border border-border bg-surface p-1 text-sm" role="tablist">
        {(Object.keys(VIEWS) as (keyof typeof VIEWS)[]).map((v) => (
          <Link
            key={v}
            href={`/admin/exams?view=${v}`}
            className={cn("rounded-md px-4 py-1.5", v === view ? "bg-brand text-brand-ink" : "hover:bg-surface-2")}
          >
            {VIEWS[v]}
          </Link>
        ))}
      </div>
      <Card>
        {rows.length === 0 ? (
          <EmptyState title={`No exams ${view === "today" ? "today" : view === "upcoming" ? "coming up" : "in the past"}`}>
            Approve a test and give it a date under Approvals.
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
