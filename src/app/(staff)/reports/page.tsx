import type { Metadata } from "next";
import Link from "next/link";
import { Badge, Card, CardHeader, EmptyState, Input, PageHeader, Select, Table, Td, Th } from "@/components/ui";
import { PercentBar } from "@/components/charts";
import { requireStaff } from "@/lib/auth";
import { fullName, getStructure } from "@/lib/data";
import { TYPE_LABEL } from "@/lib/labels";
import { percent, summarize } from "@/lib/reports";
import { visibleClassIds } from "@/lib/scope";
import { createClient } from "@/lib/supabase/server";
import type { AssessmentType } from "@/lib/types";

export const metadata: Metadata = { title: "Reports" };

export default async function ReportsHome(props: PageProps<"/reports">) {
  const sp = await props.searchParams;
  const staff = await requireStaff();
  const s = await getStructure();
  const termId = typeof sp.term === "string" ? sp.term : (s.currentTerm?.id ?? "");
  const q = typeof sp.q === "string" ? sp.q.trim() : "";
  const supabase = await createClient();
  await supabase.rpc("finalize_expired_attempts");

  const [{ data: assessments }, classIds] = await Promise.all([
    supabase
      .from("assessments")
      .select("id, title, type, subject_id, year_id, attempts(score, max_score, status)")
      .eq("term_id", termId)
      .eq("status", "approved")
      .order("subject_id"),
    visibleClassIds(staff, s),
  ]);
  const { data: found } = q
    ? await supabase
        .from("students")
        .select("id, admission_no, first_name, last_name, other_names, class_id")
        .or(`search_name.ilike.%${q.toLowerCase().replace(/[%,()]/g, "")}%,admission_no.ilike.%${q.replace(/[%,()]/g, "")}%`)
        .limit(20)
    : { data: null };

  type A = { id: string; title: string; type: AssessmentType; subject_id: string; year_id: string; attempts: { score: number; max_score: number; status: string }[] };
  const rows = ((assessments ?? []) as unknown as A[]).map((a) => {
    const pcts = a.attempts.filter((t) => t.status === "submitted").map(percent).filter((v): v is number => v != null);
    return { ...a, summary: summarize(pcts, 50) };
  });
  const classes = s.classes.filter((c) => classIds.has(c.id));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reports"
        description="Pick a test for question-by-question analysis, a class for the combined broadsheet, or a student for their full record."
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
          <span className="block text-xs text-muted">Find a student</span>
          <Input name="q" defaultValue={q} placeholder="Name or admission no." className="w-64" />
        </label>
        <button className="h-10 rounded-lg border border-border px-4 text-sm hover:bg-surface-2">Go</button>
      </form>

      {found ? (
        <Card>
          <CardHeader title={`Students matching “${q}”`} />
          {found.length === 0 ? (
            <EmptyState title="No students found among the classes you can see" />
          ) : (
            <ul className="divide-y divide-border">
              {found.map((st) => (
                <li key={st.id}>
                  <Link href={`/reports/student/${st.id}?term=${termId}`} className="flex justify-between px-5 py-2.5 text-sm hover:bg-surface-2">
                    <span className="font-medium">{fullName(st)}</span>
                    <span className="text-muted">
                      {s.className(st.class_id)} · {st.admission_no}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      ) : null}

      <Card>
        <CardHeader title="Class broadsheets" description="Every student in a class against every subject you can see — the combined view." />
        {classes.length === 0 ? (
          <EmptyState title="No classes yet" />
        ) : (
          <div className="flex flex-wrap gap-2 p-5">
            {classes.map((c) => (
              <Link
                key={c.id}
                href={`/reports/class/${c.id}?term=${termId}`}
                className="rounded-lg border border-border px-4 py-2 text-sm font-medium hover:border-brand hover:text-brand"
              >
                {c.name}
              </Link>
            ))}
          </div>
        )}
      </Card>

      <Card>
        <CardHeader title="Tests & exams this term" description="Scores for all students, plus which questions they missed." />
        {rows.length === 0 ? (
          <EmptyState title="No approved tests in this term yet" />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Test</Th>
                <Th>Subject</Th>
                <Th>Year</Th>
                <Th>Sat</Th>
                <Th>Average</Th>
                <Th>Pass rate</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id}>
                  <Td>
                    <Link href={`/reports/assessment/${a.id}`} className="font-medium text-brand hover:underline">
                      {a.title}
                    </Link>{" "}
                    <Badge>{TYPE_LABEL[a.type]}</Badge>
                  </Td>
                  <Td>{s.subjectById.get(a.subject_id)?.name}</Td>
                  <Td>{s.yearById.get(a.year_id)?.name}</Td>
                  <Td className="tabular-nums">{a.summary.count}</Td>
                  <Td>
                    <PercentBar value={a.summary.mean} />
                  </Td>
                  <Td className="tabular-nums">{a.summary.passRate == null ? "—" : `${a.summary.passRate}%`}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
