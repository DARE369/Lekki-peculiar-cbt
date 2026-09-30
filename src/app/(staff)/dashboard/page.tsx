import type { Metadata } from "next";
import Link from "next/link";
import { Badge, Card, CardHeader, EmptyState, LinkButton, PageHeader, Stat, Table, Td, Th } from "@/components/ui";
import { can, requireStaff } from "@/lib/auth";
import { formatDateTime, getStructure } from "@/lib/data";
import { STATUS_LABEL, TYPE_LABEL, WINDOW_LABEL, windowState } from "@/lib/labels";
import { createClient } from "@/lib/supabase/server";
import type { AssessmentStatus, AssessmentType } from "@/lib/types";

export const metadata: Metadata = { title: "Dashboard" };

export default async function Dashboard() {
  const staff = await requireStaff();
  const s = await getStructure();
  const supabase = await createClient();

  const now = new Date();
  const dayStart = new Date(now.getTime() - 12 * 3600_000).toISOString();
  const weekAhead = new Date(now.getTime() + 7 * 24 * 3600_000).toISOString();

  const [assignments, mine, windows] = await Promise.all([
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
      .limit(8),
    supabase
      .from("exam_windows")
      .select("id, class_id, starts_at, ends_at, status, auto_start, assessments(title, type, subject_id)")
      .gte("ends_at", dayStart)
      .lte("starts_at", weekAhead)
      .order("starts_at")
      .limit(20),
  ]);

  const approved = (assignments.data ?? []).filter((a) => a.status === "approved");
  const requested = (assignments.data ?? []).filter((a) => a.status === "requested");
  type W = {
    id: string;
    class_id: string;
    starts_at: string;
    ends_at: string;
    status: string;
    auto_start: boolean;
    assessments: { title: string; type: AssessmentType; subject_id: string } | null;
  };
  const upcoming = ((windows.data ?? []) as unknown as W[]).filter(
    (w) => !staff.isAdmin || staff.isSuperAdmin || staff.sectionIds.includes(s.sectionOfClass(w.class_id)?.id ?? ""),
  );
  const liveNow = upcoming.filter((w) => windowState(w) === "live").length;
  const awaiting = upcoming.filter((w) => windowState(w) === "awaiting_start").length;

  return (
    <div>
      <PageHeader
        title={`Good ${now.getHours() < 12 ? "morning" : now.getHours() < 17 ? "afternoon" : "evening"}, ${staff.fullName.split(" ")[0]}`}
        description={s.currentTerm ? `${s.currentTerm.session_name} · ${s.currentTerm.name}` : "No current term set"}
        actions={
          <>
            <LinkButton href="/teach/assessments/new">New test or exam</LinkButton>
            <LinkButton href="/teach/questions/import" variant="secondary">
              Upload questions
            </LinkButton>
          </>
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Classes I teach" value={approved.length} hint={requested.length ? `${requested.length} awaiting approval` : undefined} />
        <Stat label="My tests & exams" value={mine.data?.length ?? 0} />
        <Stat label="Live now" value={liveNow} tone={liveNow ? "success" : undefined} />
        <Stat label="Waiting for start" value={awaiting} tone={awaiting ? "warning" : undefined} hint={staff.isAdmin && can(staff, "exam.start") ? "You can start these" : undefined} />
      </div>

      {approved.length === 0 ? (
        <Card className="mb-6">
          <EmptyState
            title="You haven't been assigned any classes yet"
            action={<LinkButton href="/teach/classes">Tell us what you teach</LinkButton>}
          >
            Pick the subjects and classes you teach. Your Head of Section approves them, then you can set questions and see
            results.
          </EmptyState>
        </Card>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Exams today & this week"
            actions={staff.isAdmin ? <LinkButton href="/admin/exams" size="sm" variant="secondary">Open monitor</LinkButton> : undefined}
          />
          {upcoming.length === 0 ? (
            <EmptyState title="Nothing scheduled" />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Exam</Th>
                  <Th>Class</Th>
                  <Th>When</Th>
                  <Th>Status</Th>
                </tr>
              </thead>
              <tbody>
                {upcoming.map((w) => {
                  const [label, tone] = WINDOW_LABEL[windowState(w)];
                  return (
                    <tr key={w.id}>
                      <Td>
                        <span className="font-medium">{w.assessments?.title}</span>
                        <span className="block text-xs text-muted">
                          {s.subjectById.get(w.assessments?.subject_id ?? "")?.name} · {TYPE_LABEL[w.assessments?.type ?? "test"]}
                        </span>
                      </Td>
                      <Td>{s.className(w.class_id)}</Td>
                      <Td className="whitespace-nowrap">{formatDateTime(w.starts_at)}</Td>
                      <Td>
                        {staff.isAdmin ? (
                          <Link href={`/admin/exams/${w.id}`}>
                            <Badge tone={tone}>{label}</Badge>
                          </Link>
                        ) : (
                          <Badge tone={tone}>{label}</Badge>
                        )}
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          )}
        </Card>

        <Card>
          <CardHeader
            title="My recent tests & exams"
            actions={<LinkButton href="/teach/assessments" size="sm" variant="secondary">See all</LinkButton>}
          />
          {(mine.data ?? []).length === 0 ? (
            <EmptyState title="No tests yet" action={<LinkButton href="/teach/assessments/new" size="sm">Create one</LinkButton>} />
          ) : (
            <ul className="divide-y divide-border">
              {(mine.data ?? []).map((a) => {
                const [label, tone] = STATUS_LABEL[a.status as AssessmentStatus];
                return (
                  <li key={a.id}>
                    <Link href={`/teach/assessments/${a.id}`} className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-surface-2">
                      <span>
                        <span className="font-medium">{a.title}</span>
                        <span className="block text-xs text-muted">
                          {s.subjectById.get(a.subject_id)?.name} · {s.yearById.get(a.year_id)?.name} · {TYPE_LABEL[a.type as AssessmentType]}
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
    </div>
  );
}
