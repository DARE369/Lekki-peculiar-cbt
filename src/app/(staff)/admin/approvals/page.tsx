import type { Metadata } from "next";
import { ClipboardCheck } from "lucide-react";
import Link from "next/link";
import { Alert, Badge, Card, EmptyState, PageHeader, Table, Td, Th, cn } from "@/components/ui";
import { can, requireAdmin } from "@/lib/auth";
import { formatDateTime, getStructure } from "@/lib/data";
import { TYPE_LABEL } from "@/lib/labels";
import { loadReviewTests } from "@/lib/review-data";
import { createClient } from "@/lib/supabase/server";
import type { AssessmentType } from "@/lib/types";
import { ReviewBoard } from "./review-board";

export const metadata: Metadata = { title: "Approvals" };

export default async function Approvals(props: PageProps<"/admin/approvals">) {
  const staff = await requireAdmin();
  const sp = await props.searchParams;
  const s = await getStructure();

  const tab = sp.tab === "approved" ? "approved" : "pending";

  const classOrder = s.classes.filter((c) => c.active).map((c) => c.id);
  const names = {
    subjects: Object.fromEntries(s.subjects.map((x) => [x.id, x.name])),
    years: Object.fromEntries(s.years.map((y) => [y.id, y.name])),
    classes: Object.fromEntries(s.classes.map((c) => [c.id, c.name])),
    classOrder,
  };

  return (
    <div className="space-y-6">
      <PageHeader
        icon={ClipboardCheck}
        title="Approvals"
        description="Review every test set for your classes in one place. Approve the good ones together, flag the ones that need a second look, and send back the rest."
      />
      {typeof sp.error === "string" ? <Alert tone="danger">{sp.error}</Alert> : null}
      {sp.settled ? <Alert tone="success">Done.</Alert> : null}

      <div className="flex gap-1 rounded-lg border border-border bg-surface p-1 text-sm" role="tablist">
        {(["pending", "approved"] as const).map((v) => (
          <Link
            key={v}
            href={`/admin/approvals?tab=${v}`}
            className={cn("rounded-md px-4 py-1.5 capitalize", v === tab ? "bg-brand text-brand-ink" : "hover:bg-surface-2")}
          >
            {v === "pending" ? "Pending review" : "Approved"}
          </Link>
        ))}
      </div>

      {tab === "pending" ? (
        <PendingTab s={s} names={names} canDecide={can(staff, "exam.approve")} />
      ) : (
        <ApprovedTab s={s} />
      )}
    </div>
  );
}

async function PendingTab({ s, names, canDecide }: { s: Awaited<ReturnType<typeof getStructure>>; names: Record<string, unknown>; canDecide: boolean }) {
  const tests = await loadReviewTests(s);
  return <ReviewBoard tests={tests} names={names as unknown as Parameters<typeof ReviewBoard>[0]["names"]} canDecide={canDecide} />;
}

async function ApprovedTab({ s }: { s: Awaited<ReturnType<typeof getStructure>> }) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("assessments")
    .select("id, title, type, subject_id, year_id, question_count, reviewed_at, reviewed_by, flag_status, flag_category, flag_note, staff:reviewed_by(full_name), teacher:created_by(full_name), topic")
    .eq("status", "approved")
    .eq("term_id", s.currentTerm?.id ?? "")
    .order("reviewed_at", { ascending: false })
    .limit(200);

  type Row = {
    id: string; title: string; type: AssessmentType; subject_id: string; year_id: string; question_count: number;
    reviewed_at: string | null; reviewed_by: string | null; flag_status: string | null; flag_category: string | null;
    flag_note: string | null; staff: { full_name: string } | null; teacher: { full_name: string } | null; topic: string | null;
  };
  const rows = (data ?? []) as unknown as Row[];

  if (rows.length === 0) {
    return (
      <Card>
        <EmptyState title="No approved tests yet">
          Reviewed and approved tests will appear here.
        </EmptyState>
      </Card>
    );
  }

  return (
    <Card>
      <div className="border-b border-border px-5 py-3 text-sm text-muted">
        {rows.length} approved test{rows.length === 1 ? "" : "s"} this term
      </div>
      <Table stack>
        <thead>
          <tr>
            <Th>Test</Th>
            <Th>Teacher</Th>
            <Th>Year</Th>
            <Th>Questions</Th>
            <Th>Approved</Th>
            <Th>Flags</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="hover:bg-surface-2">
              <Td>
                <Link href={`/admin/approvals/${r.id}`} className="font-medium text-brand hover:underline">
                  {r.title}
                </Link>
                <span className="block text-xs text-muted">
                  {s.subjectById.get(r.subject_id)?.name} · {TYPE_LABEL[r.type]}
                  {r.topic ? ` · ${r.topic}` : ""}
                </span>
              </Td>
              <Td label="Teacher" className="text-sm">{(r.teacher as unknown as { full_name: string } | null)?.full_name ?? "—"}</Td>
              <Td label="Year" className="text-sm">{s.yearById.get(r.year_id)?.name ?? "—"}</Td>
              <Td label="Questions" className="text-sm">{r.question_count}</Td>
              <Td label="Approved" className="text-xs text-muted">
                {r.reviewed_at ? formatDateTime(r.reviewed_at) : "—"}
                {r.staff ? <span className="block">by {(r.staff as unknown as { full_name: string }).full_name}</span> : null}
              </Td>
              <Td label="Flags">
                {r.flag_status === "open" ? (
                  <Badge tone="danger">{r.flag_category ?? "Flagged"}</Badge>
                ) : r.flag_status === "resolved" ? (
                  <Badge tone="neutral">Resolved</Badge>
                ) : (
                  <span className="text-xs text-muted">—</span>
                )}
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </Card>
  );
}
