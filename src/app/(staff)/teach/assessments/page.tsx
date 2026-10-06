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
  const isAdmin = staff.isAdmin || staff.isSuperAdmin;
  const termId = isAdmin && typeof sp.term === "string" ? sp.term : (s.currentTerm?.id ?? "");
  const scope = sp.scope === "all" ? "all" : "mine";
  const teacherFilter = typeof sp.teacher === "string" ? sp.teacher : "";
  const supabase = await createClient();

  let query = supabase
    .from("assessments")
    .select("id, title, type, status, subject_id, year_id, question_count, duration_minutes, updated_at, created_by, staff:created_by(id, full_name)")
    .order("updated_at", { ascending: false });

  if (termId) query = query.eq("term_id", termId);

  if (scope === "mine") {
    query = query.eq("created_by", staff.id);
  } else if (isAdmin) {
    // Restrict to subjects within the admin's own sections
    const sectionSubjectIds = [...s.subjectById.values()]
      .filter((sub) => staff.isSuperAdmin || (staff.sectionIds as string[]).includes(sub.section_id))
      .map((sub) => sub.id);
    if (sectionSubjectIds.length > 0) query = query.in("subject_id", sectionSubjectIds);
  }

  if (teacherFilter) query = query.eq("created_by", teacherFilter);

  const { data } = await query;
  const assessments = data ?? [];

  // Fetch earliest exam window for each assessment so teachers can see when their exam is scheduled.
  const assessmentIds = assessments.map((a) => a.id);
  const { data: windowData } = assessmentIds.length
    ? await supabase.from("exam_windows").select("assessment_id, starts_at, class_id").in("assessment_id", assessmentIds).order("starts_at")
    : { data: [] };
  // Map assessmentId → earliest window start (and class count)
  type WinInfo = { startsAt: string; classCount: number };
  const windowMap = new Map<string, WinInfo>();
  for (const w of windowData ?? []) {
    const existing = windowMap.get(w.assessment_id);
    if (!existing || w.starts_at < existing.startsAt) {
      windowMap.set(w.assessment_id, { startsAt: w.starts_at, classCount: (existing?.classCount ?? 0) + 1 });
    } else {
      existing.classCount += 1;
    }
  }

  type Assessment = (typeof assessments)[number];
  type StaffRef = { id: string; full_name: string } | null;

  const showGrouped = isAdmin && scope === "all";

  // Build unique teacher list for filter dropdown (admin grouped view only)
  const teacherMap = new Map<string, string>();
  if (showGrouped) {
    for (const a of assessments) {
      const t = a.staff as unknown as StaffRef;
      if (t) teacherMap.set(t.id, t.full_name);
    }
  }

  // Build year → subject → assessments grouping
  const yearSubjectMap = new Map<string, Map<string, Assessment[]>>();
  if (showGrouped) {
    for (const a of assessments) {
      if (!yearSubjectMap.has(a.year_id)) yearSubjectMap.set(a.year_id, new Map());
      const subMap = yearSubjectMap.get(a.year_id)!;
      if (!subMap.has(a.subject_id)) subMap.set(a.subject_id, []);
      subMap.get(a.subject_id)!.push(a);
    }
  }

  const yearEntries = [...yearSubjectMap.entries()].sort((a, b) => {
    const al = s.yearById.get(a[0])?.level ?? 0;
    const bl = s.yearById.get(b[0])?.level ?? 0;
    return al - bl;
  });

  return (
    <div className="space-y-6">
      <PageHeader
        icon={BookOpenCheck}
        title="Tests & exams"
        description="Create a test, add questions, then submit it for approval. Your Head of Section sets the date."
        actions={<LinkButton href="/teach/assessments/new">New test or exam</LinkButton>}
      />
      <form className="flex flex-wrap items-end gap-3">
        {isAdmin ? (
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
        ) : null}
        <label className="space-y-1">
          <span className="block text-xs text-muted">Show</span>
          <Select name="scope" defaultValue={scope} className="w-56">
            <option value="mine">Created by me</option>
            <option value="all">All I can see (my subjects)</option>
          </Select>
        </label>
        {showGrouped && teacherMap.size > 0 ? (
          <label className="space-y-1">
            <span className="block text-xs text-muted">Teacher</span>
            <Select name="teacher" defaultValue={teacherFilter} className="w-56">
              <option value="">All teachers</option>
              {[...teacherMap.entries()]
                .sort((a, b) => a[1].localeCompare(b[1]))
                .map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
            </Select>
          </label>
        ) : null}
        <button className="h-10 rounded-lg border border-border px-4 text-sm hover:bg-surface-2">Apply</button>
      </form>

      {showGrouped ? (
        assessments.length === 0 ? (
          <Card>
            <EmptyState title="No tests found" />
          </Card>
        ) : (
          <div className="space-y-8">
            {yearEntries.map(([yearId, subjectMap]) => {
              const yearName = s.yearById.get(yearId)?.name ?? yearId;
              const subjectEntries = [...subjectMap.entries()].sort((a, b) => {
                const an = s.subjectById.get(a[0])?.name ?? "";
                const bn = s.subjectById.get(b[0])?.name ?? "";
                return an.localeCompare(bn);
              });
              return (
                <section key={yearId}>
                  <h2 className="mb-3 text-base font-semibold">{yearName}</h2>
                  <div className="space-y-3">
                    {subjectEntries.map(([subjectId, tests]) => {
                      const subjectName = s.subjectById.get(subjectId)?.name ?? subjectId;
                      return (
                        <Card key={subjectId} className="overflow-hidden">
                          <div className="border-b border-border bg-surface-2 px-4 py-2.5">
                            <h3 className="text-sm font-semibold">{subjectName}</h3>
                          </div>
                          <Table stack>
                            <thead>
                              <tr>
                                <Th>Title</Th>
                                <Th>Teacher</Th>
                                <Th>Questions</Th>
                                <Th>Status</Th>
                                <Th>Scheduled</Th>
                                <Th>Updated</Th>
                              </tr>
                            </thead>
                            <tbody>
                              {tests.map((a) => {
                                const [label, tone] = STATUS_LABEL[a.status as AssessmentStatus];
                                const teacher = a.staff as unknown as StaffRef;
                                const win = windowMap.get(a.id);
                                return (
                                  <tr key={a.id}>
                                    <Td>
                                      <Link href={`/teach/assessments/${a.id}`} className="text-brand font-medium hover:underline">
                                        {a.title}
                                      </Link>
                                      <span className="block text-xs text-muted">{TYPE_LABEL[a.type as AssessmentType]}</span>
                                    </Td>
                                    <Td label="Teacher" className="text-sm">
                                      {teacher?.full_name ?? "—"}
                                    </Td>
                                    <Td label="Questions" className="tabular-nums">
                                      {a.question_count} · {a.duration_minutes} min
                                    </Td>
                                    <Td label="Status">
                                      <Badge tone={tone}>{label}</Badge>
                                    </Td>
                                    <Td label="Scheduled" className="text-xs whitespace-nowrap text-muted">
                                      {win ? formatDateTime(win.startsAt) : a.status === "approved" ? <span className="text-warning">No date set</span> : "—"}
                                    </Td>
                                    <Td label="Updated" className="text-xs whitespace-nowrap text-muted">
                                      {formatDateTime(a.updated_at)}
                                    </Td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </Table>
                        </Card>
                      );
                    })}
                  </div>
                </section>
              );
            })}
          </div>
        )
      ) : (
        <Card>
          {assessments.length === 0 ? (
            <EmptyState title="Nothing here yet" action={<LinkButton href="/teach/assessments/new">Create your first test</LinkButton>} />
          ) : (
            <Table stack>
              <thead>
                <tr>
                  <Th>Title</Th>
                  <Th>Subject</Th>
                  <Th>Year</Th>
                  <Th>Questions</Th>
                  <Th>Status</Th>
                  <Th>Scheduled</Th>
                  <Th>Updated</Th>
                </tr>
              </thead>
              <tbody>
                {assessments.map((a) => {
                  const [label, tone] = STATUS_LABEL[a.status as AssessmentStatus];
                  const win = windowMap.get(a.id);
                  return (
                    <tr key={a.id}>
                      <Td>
                        <Link href={`/teach/assessments/${a.id}`} className="text-brand font-medium hover:underline">
                          {a.title}
                        </Link>
                        <span className="block text-xs text-muted">
                          {TYPE_LABEL[a.type as AssessmentType]}
                          {scope === "all"
                            ? ` · ${(a.staff as unknown as { full_name: string } | null)?.full_name}`
                            : ""}
                        </span>
                      </Td>
                      <Td label="Subject">{s.subjectById.get(a.subject_id)?.name}</Td>
                      <Td label="Year">{s.yearById.get(a.year_id)?.name}</Td>
                      <Td label="Questions" className="tabular-nums">
                        {a.question_count} · {a.duration_minutes} min
                      </Td>
                      <Td label="Status">
                        <Badge tone={tone}>{label}</Badge>
                      </Td>
                      <Td label="Scheduled" className="text-xs whitespace-nowrap text-muted">
                        {win ? formatDateTime(win.startsAt) : a.status === "approved" ? <span className="text-warning">No date set</span> : "—"}
                      </Td>
                      <Td label="Updated" className="text-xs whitespace-nowrap text-muted">
                        {formatDateTime(a.updated_at)}
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          )}
        </Card>
      )}
    </div>
  );
}
