import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ScoreCell } from "@/components/charts";
import { PrintButton } from "@/components/print-button";
import { Avatar, Card, EmptyState, PageHeader, Select, Table, Td, Th, cn } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { fullName, getStructure } from "@/lib/data";
import { signPhotos } from "@/lib/photos";
import { loadClassAttempts, type StudentLite } from "@/lib/report-data";
import { buildBroadsheet, ordinal } from "@/lib/reports";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Class broadsheet" };

const TYPES = { all: "Tests, exams & mocks", test: "Tests only", exam: "Exams only", mock: "Mocks only", practice: "Practice only" } as const;

export default async function ClassBroadsheet(props: PageProps<"/reports/class/[classId]">) {
  const { classId } = await props.params;
  const sp = await props.searchParams;
  const staff = await requireStaff();
  const s = await getStructure();
  const cls = s.classById.get(classId);
  if (!cls) notFound();
  const termId = typeof sp.term === "string" ? sp.term : (s.currentTerm?.id ?? "");
  const subjectId = typeof sp.subject === "string" && sp.subject ? sp.subject : "";
  const type = (typeof sp.type === "string" && sp.type in TYPES ? sp.type : "all") as keyof typeof TYPES;

  const all = await loadClassAttempts(classId, termId);
  const filtered = all.filter(
    (a) =>
      a.assessments &&
      (type === "all" ? a.assessments.type !== "practice" : a.assessments.type === type) &&
      (!subjectId || a.assessments.subject_id === subjectId),
  );
  const subjectsSeen = [...new Set(all.map((a) => a.assessments?.subject_id).filter(Boolean) as string[])];

  const supabase = await createClient();
  const { data: roster } = await supabase
    .from("students")
    .select("id, admission_no, first_name, last_name, other_names, class_id, photo_path")
    .eq("class_id", classId)
    .eq("active", true)
    .order("last_name");
  const students = new Map(((roster ?? []) as StudentLite[]).map((x) => [x.id, x]));
  const missing = [...new Set(filtered.map((a) => a.student_id))].filter((id) => !students.has(id));
  if (missing.length) {
    const { data } = await supabase.from("students").select("id, admission_no, first_name, last_name, other_names, class_id, photo_path").in("id", missing);
    for (const x of (data ?? []) as StudentLite[]) students.set(x.id, x);
  }
  const titles = new Map(filtered.map((a) => [a.assessments!.id, a.assessments!.title]));
  const sheet = buildBroadsheet(
    filtered.map((a) => ({ student_id: a.student_id, score: a.score, max_score: a.max_score, assessment: a.assessments! })),
    [...students.keys()],
    subjectId ? "assessment" : "subject",
    (k) => (subjectId ? (titles.get(k) ?? k) : (s.subjectById.get(k)?.name ?? k)),
  );
  const rows = [...sheet.rows].sort((a, b) => (a.position ?? 9999) - (b.position ?? 9999));
  const photos = await signPhotos([...students.values()].map((x) => x.photo_path));
  const qs = (patch: Record<string, string>) => {
    const p = new URLSearchParams({ term: termId, type, ...(subjectId ? { subject: subjectId } : {}), ...patch });
    for (const [k, v] of [...p.entries()]) if (!v) p.delete(k);
    return `?${p.toString()}`;
  };

  return (
    <div className="space-y-6">
      <PageHeader
        back={{ href: "/reports", label: "Reports" }}
        title={`${cls.name} — ${subjectId ? s.subjectById.get(subjectId)?.name : "all subjects"}`}
        description={
          staff.isAdmin
            ? "Average percentage per subject for the term. Click a subject to see each test."
            : "Only the subjects you teach this class are shown. Click a subject to see each test."
        }
        actions={
          <>
            <a
              href={`/api/reports/class/${classId}${qs({})}`}
              className="inline-flex h-10 items-center rounded-lg border border-border px-4 text-sm hover:bg-surface-2"
            >
              Download CSV
            </a>
            <PrintButton />
          </>
        }
      />
      <form className="no-print flex flex-wrap items-end gap-3">
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
          <span className="block text-xs text-muted">Subject</span>
          <Select name="subject" defaultValue={subjectId} className="w-56">
            <option value="">All subjects (combined)</option>
            {subjectsSeen.map((id) => (
              <option key={id} value={id}>
                {s.subjectById.get(id)?.name}
              </option>
            ))}
          </Select>
        </label>
        <label className="space-y-1">
          <span className="block text-xs text-muted">Include</span>
          <Select name="type" defaultValue={type} className="w-52">
            {Object.entries(TYPES).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
        </label>
        <button className="h-10 rounded-lg border border-border px-4 text-sm hover:bg-surface-2">Show</button>
      </form>

      <Card>
        {sheet.columns.length === 0 ? (
          <EmptyState title="No results yet for this selection" />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Pos.</Th>
                <Th>Student</Th>
                {sheet.columns.map((c) => (
                  <Th key={c.key} className="text-right">
                    {subjectId ? (
                      <Link href={`/reports/assessment/${c.key}?class=${classId}`} className="hover:text-brand">
                        {c.label}
                      </Link>
                    ) : (
                      <Link href={qs({ subject: c.key })} className="hover:text-brand">
                        {c.label}
                      </Link>
                    )}
                  </Th>
                ))}
                <Th className="text-right">Average</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const st = students.get(r.studentId);
                if (!st) return null;
                return (
                  <tr key={r.studentId}>
                    <Td className="tabular-nums">{r.position ? ordinal(r.position) : "—"}</Td>
                    <Td>
                      <Link href={`/reports/student/${st.id}?term=${termId}`} className="flex items-center gap-2 hover:underline">
                        <Avatar src={st.photo_path ? photos.get(st.photo_path) : null} name={fullName(st)} size={28} />
                        <span className="font-medium">{fullName(st)}</span>
                      </Link>
                    </Td>
                    {sheet.columns.map((c) => (
                      <Td key={c.key} className="text-right">
                        <ScoreCell value={r.cells[c.key]} />
                      </Td>
                    ))}
                    <Td className="text-right font-semibold">
                      <ScoreCell value={r.average} />
                    </Td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="bg-surface-2">
                <Td />
                <Td className="font-medium">Class average</Td>
                {sheet.columns.map((c) => (
                  <Td key={c.key} className={cn("text-right font-medium tabular-nums")}>
                    {c.classAverage ?? "—"}
                  </Td>
                ))}
                <Td />
              </tr>
            </tfoot>
          </Table>
        )}
      </Card>
      <p className="text-xs text-muted">Figures are percentages. Marks below 50 are shown in red. “—” means the student has no result for that column.</p>
    </div>
  );
}

