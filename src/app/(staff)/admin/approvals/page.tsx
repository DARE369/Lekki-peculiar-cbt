import type { Metadata } from "next";
import { ClipboardCheck } from "lucide-react";
import Link from "next/link";
import { Badge, Card, CardHeader, EmptyState, PageHeader, Table, Td, Th } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { formatDateTime, getStructure } from "@/lib/data";
import { TYPE_LABEL } from "@/lib/labels";
import { createClient } from "@/lib/supabase/server";
import type { AssessmentType } from "@/lib/types";

export const metadata: Metadata = { title: "Approvals" };

export default async function Approvals() {
  await requireAdmin();
  const s = await getStructure();
  const supabase = await createClient();
  const [{ data: pending }, { data: approved }] = await Promise.all([
    supabase
      .from("assessments")
      .select("id, title, type, subject_id, year_id, question_count, duration_minutes, submitted_at, staff:created_by(full_name)")
      .eq("status", "pending_approval")
      .order("submitted_at"),
    supabase
      .from("assessments")
      .select("id, title, type, subject_id, year_id, reviewed_at, exam_windows(id)")
      .eq("status", "approved")
      .order("reviewed_at", { ascending: false })
      .limit(100),
  ]);
  const unscheduled = (approved ?? []).filter((a) => ((a.exam_windows as unknown[]) ?? []).length === 0);

  return (
    <div className="space-y-6">
      <PageHeader
        icon={ClipboardCheck} title="Approvals" description="Check each test, then approve it and set the date for each class. Nobody can sit a test until you do." />
      <Card>
        <CardHeader title={`Waiting for you (${(pending ?? []).length})`} />
        {(pending ?? []).length === 0 ? (
          <EmptyState title="All caught up" />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Test</Th>
                <Th>Teacher</Th>
                <Th>Year</Th>
                <Th>Size</Th>
                <Th>Submitted</Th>
              </tr>
            </thead>
            <tbody>
              {(pending ?? []).map((a) => (
                <tr key={a.id}>
                  <Td>
                    <Link href={`/admin/approvals/${a.id}`} className="font-medium text-brand hover:underline">
                      {a.title}
                    </Link>
                    <span className="block text-xs text-muted">
                      {s.subjectById.get(a.subject_id)?.name} · {TYPE_LABEL[a.type as AssessmentType]}
                    </span>
                  </Td>
                  <Td>{(a.staff as unknown as { full_name: string } | null)?.full_name}</Td>
                  <Td>{s.yearById.get(a.year_id)?.name}</Td>
                  <Td className="tabular-nums">
                    {a.question_count} q · {a.duration_minutes} min
                  </Td>
                  <Td className="text-xs text-muted">{formatDateTime(a.submitted_at)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      {unscheduled.length ? (
        <Card>
          <CardHeader title="Approved but not scheduled" description="These need a date before students can sit them." />
          <ul className="divide-y divide-border">
            {unscheduled.map((a) => (
              <li key={a.id}>
                <Link href={`/admin/approvals/${a.id}`} className="flex items-center justify-between px-5 py-3 text-sm hover:bg-surface-2">
                  <span>
                    <span className="font-medium">{a.title}</span>
                    <span className="block text-xs text-muted">
                      {s.subjectById.get(a.subject_id)?.name} · {s.yearById.get(a.year_id)?.name}
                    </span>
                  </span>
                  <Badge tone="warning">Needs a date</Badge>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
