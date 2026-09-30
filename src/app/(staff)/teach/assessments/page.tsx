import type { Metadata } from "next";
import { BookOpenCheck } from "lucide-react";
import Link from "next/link";
import { Badge, Card, EmptyState, LinkButton, PageHeader, Select, Table, Td, Th } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { formatDateTime, getStructure } from "@/lib/data";
import { STATUS_LABEL, TYPE_LABEL } from "@/lib/labels";
import { createClient } from "@/lib/supabase/server";
import type { AssessmentStatus, AssessmentType } from "@/lib/types";

export const metadata: Metadata = { title: "Tests & exams" };

export default async function AssessmentsPage(props: PageProps<"/teach/assessments">) {
  const sp = await props.searchParams;
  const staff = await requireStaff();
  const s = await getStructure();
  const termId = typeof sp.term === "string" ? sp.term : (s.currentTerm?.id ?? "");
  const scope = sp.scope === "all" ? "all" : "mine";
  const supabase = await createClient();
  let query = supabase
    .from("assessments")
    .select("id, title, type, status, subject_id, year_id, question_count, duration_minutes, updated_at, created_by, staff:created_by(full_name)")
    .order("updated_at", { ascending: false });
  if (termId) query = query.eq("term_id", termId);
  if (scope === "mine") query = query.eq("created_by", staff.id);
  const { data } = await query;

  return (
    <div className="space-y-6">
      <PageHeader
        icon={BookOpenCheck}
        title="Tests & exams"
        description="Create a test, add questions, then submit it for approval. Your Head of Section sets the date."
        actions={<LinkButton href="/teach/assessments/new">New test or exam</LinkButton>}
      />
      <form className="flex flex-wrap items-end gap-3">
        <label className="space-y-1">
          <span className="block text-xs text-muted">Term</span>
          <Select name="term" defaultValue={termId} className="w-56">
            {s.terms.map((t) => (
              <option key={t.id} value={t.id}>
                {t.session_name} · {t.name}
              </option>
            ))}
          </Select>
        </label>
        <label className="space-y-1">
          <span className="block text-xs text-muted">Show</span>
          <Select name="scope" defaultValue={scope} className="w-56">
            <option value="mine">Created by me</option>
            <option value="all">All I can see (my subjects)</option>
          </Select>
        </label>
        <button className="h-10 rounded-lg border border-border px-4 text-sm hover:bg-surface-2">Apply</button>
      </form>
      <Card>
        {(data ?? []).length === 0 ? (
          <EmptyState title="Nothing here yet" action={<LinkButton href="/teach/assessments/new">Create your first test</LinkButton>} />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Title</Th>
                <Th>Subject</Th>
                <Th>Year</Th>
                <Th>Questions</Th>
                <Th>Status</Th>
                <Th>Updated</Th>
              </tr>
            </thead>
            <tbody>
              {(data ?? []).map((a) => {
                const [label, tone] = STATUS_LABEL[a.status as AssessmentStatus];
                return (
                  <tr key={a.id}>
                    <Td>
                      <Link href={`/teach/assessments/${a.id}`} className="font-medium hover:underline">
                        {a.title}
                      </Link>
                      <span className="block text-xs text-muted">
                        {TYPE_LABEL[a.type as AssessmentType]}
                        {scope === "all" ? ` · ${(a.staff as unknown as { full_name: string } | null)?.full_name}` : ""}
                      </span>
                    </Td>
                    <Td>{s.subjectById.get(a.subject_id)?.name}</Td>
                    <Td>{s.yearById.get(a.year_id)?.name}</Td>
                    <Td className="tabular-nums">
                      {a.question_count} · {a.duration_minutes} min
                    </Td>
                    <Td>
                      <Badge tone={tone}>{label}</Badge>
                    </Td>
                    <Td className="text-xs whitespace-nowrap text-muted">{formatDateTime(a.updated_at)}</Td>
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
