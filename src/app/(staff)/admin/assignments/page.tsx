import type { Metadata } from "next";
import { Users } from "lucide-react";
import { Alert, Badge, Card, CardHeader, EmptyState, Field, PageHeader, Select, Table, Td, Th, cn } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/forms";
import { can, requireAdmin } from "@/lib/auth";
import { getStructure } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";
import { assignTeacher, decideAssignment, removeAssignment } from "../actions";
import { RemoveButton } from "./remove-button";

export const metadata: Metadata = { title: "Class assignments" };

export default async function AssignmentsPage(props: PageProps<"/admin/assignments">) {
  const sp = await props.searchParams;
  const staff = await requireAdmin();
  const s = await getStructure();
  const supabase = await createClient();

  const [{ data: rows }, { data: teachers }, { data: testRows }] = await Promise.all([
    supabase
      .from("teaching_assignments")
      .select("id, teacher_id, subject_id, class_id, status, staff:teacher_id(full_name)")
      .eq("session_id", s.currentSessionId ?? ""),
    supabase.from("staff").select("id, full_name").eq("active", true).order("full_name"),
    supabase
      .from("assessments")
      .select("id, created_by, subject_id, year_id, status, title, created_at, term_id")
      .eq("term_id", s.currentTerm?.id ?? "")
      .order("created_at", { ascending: false }),
  ]);

  const manage = can(staff, "teachers.manage");
  const mySections = new Set(staff.isSuperAdmin ? s.sections.map((x) => x.id) : staff.sectionIds);
  const myClasses = s.classes.filter((c) => c.active && mySections.has(s.sectionOfClass(c.id)?.id ?? ""));
  const mySubjects = s.subjects.filter((x) => x.active && mySections.has(x.section_id));

  type Row = { id: string; teacher_id: string; subject_id: string; class_id: string; status: string; staff: { full_name: string } | null };
  const all = (rows ?? []) as unknown as Row[];
  const requested = all.filter((r) => r.status === "requested");
  const approved = all.filter((r) => r.status === "approved");

  // Build test lookup: key = "teacher:subject:year"
  type TestRow = { id: string; created_by: string; subject_id: string; year_id: string; status: string; title: string; created_at: string };
  const tests = (testRows ?? []) as unknown as TestRow[];
  const testsByKey = new Map<string, TestRow[]>();
  for (const t of tests) {
    const k = `${t.created_by}:${t.subject_id}:${t.year_id}`;
    testsByKey.set(k, [...(testsByKey.get(k) ?? []), t]);
  }

  const view = sp.view === "teacher" ? "teacher" : "class";

  // --- By-class grouping: year → class → [assignments]
  const byClass = new Map<string, Row[]>();
  for (const r of approved) {
    byClass.set(r.class_id, [...(byClass.get(r.class_id) ?? []), r]);
  }
  const classSorted = [...byClass.entries()].sort((a, b) =>
    s.className(a[0]).localeCompare(s.className(b[0]), undefined, { numeric: true }),
  );

  // --- By-teacher grouping: teacher → [assignments]
  const byTeacher = new Map<string, Row[]>();
  for (const r of approved) {
    byTeacher.set(r.teacher_id, [...(byTeacher.get(r.teacher_id) ?? []), r]);
  }
  const teacherSorted = [...byTeacher.entries()].sort((a, b) =>
    (a[1][0].staff?.full_name ?? "").localeCompare(b[1][0].staff?.full_name ?? ""),
  );

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Users}
        title="Class assignments"
        description={`Who teaches what in ${s.currentTerm?.session_name ?? "this session"}. Teachers only see students and results for their approved classes.`}
      />
      {!manage ? <Alert tone="warning">You can view assignments but need the "Approve teaching assignments" permission to change them.</Alert> : null}

      {/* Pending requests */}
      <Card>
        <CardHeader title={`Pending requests (${requested.length})`} />
        {requested.length === 0 ? (
          <EmptyState title="No requests waiting" />
        ) : (
          <form action={decideAssignment}>
            <Table stack>
              <thead>
                <tr>
                  <Th className="w-10" />
                  <Th>Teacher</Th>
                  <Th>Subject</Th>
                  <Th>Class</Th>
                </tr>
              </thead>
              <tbody>
                {requested.map((r) => (
                  <tr key={r.id}>
                    <Td className="cell-check">
                      <input type="checkbox" name="id" value={r.id} defaultChecked className="h-4 w-4 accent-[var(--brand)]" aria-label="Select" />
                    </Td>
                    <Td className="font-medium">{r.staff?.full_name}</Td>
                    <Td label="Subject">{s.subjectById.get(r.subject_id)?.name}</Td>
                    <Td label="Class">{s.className(r.class_id)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            {manage ? (
              <div className="flex gap-2 border-t border-border p-4">
                <SubmitButton name="decision" value="approve" size="sm">Approve ticked</SubmitButton>
                <SubmitButton name="decision" value="reject" size="sm" variant="secondary">Decline ticked</SubmitButton>
              </div>
            ) : null}
          </form>
        )}
      </Card>

      {/* Assign directly */}
      {manage ? (
        <Card>
          <CardHeader title="Assign a teacher directly" />
          <ActionForm action={assignTeacher} className="space-y-4 p-5" resetOnSuccess>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Teacher">
                <Select name="teacher_id" required defaultValue="">
                  <option value="" disabled>Choose…</option>
                  {(teachers ?? []).map((t) => (
                    <option key={t.id} value={t.id}>{t.full_name}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Subject">
                <Select name="subject_id" required defaultValue="">
                  <option value="" disabled>Choose…</option>
                  {mySubjects.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name} ({s.sectionById.get(x.section_id)?.name})
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {myClasses.map((c) => (
                <label key={c.id} className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm has-checked:border-brand has-checked:bg-brand-soft">
                  <input type="checkbox" name="class_id" value={c.id} className="accent-[var(--brand)]" />
                  {c.name}
                </label>
              ))}
            </div>
            <SubmitButton>Assign</SubmitButton>
          </ActionForm>
        </Card>
      ) : null}

      {/* Current assignments */}
      <Card>
        <CardHeader
          title={`Current assignments (${approved.length})`}
          actions={
            <div className="flex gap-1 rounded-lg border border-border bg-surface p-0.5 text-sm">
              {(["class", "teacher"] as const).map((v) => (
                <a
                  key={v}
                  href={`?view=${v}`}
                  className={cn("rounded-md px-3 py-1", view === v ? "bg-brand text-brand-ink" : "hover:bg-surface-2")}
                >
                  By {v}
                </a>
              ))}
            </div>
          }
        />
        {approved.length === 0 ? (
          <EmptyState title="No approved assignments yet" />
        ) : view === "class" ? (
          // By class: one section per class
          <div className="divide-y divide-border">
            {classSorted.map(([classId, items]) => {
              const yearId = s.classes.find((c) => c.id === classId)?.year_id ?? "";
              return (
                <div key={classId} className="px-5 py-4">
                  <h3 className="mb-3 font-semibold">{s.className(classId)}</h3>
                  <Table>
                    <thead>
                      <tr>
                        <Th>Subject</Th>
                        <Th>Teacher</Th>
                        <Th>Tests this term</Th>
                        {manage ? <Th className="w-20" /> : null}
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((r) => {
                        const myTests = testsByKey.get(`${r.teacher_id}:${r.subject_id}:${yearId}`) ?? [];
                        const submitted = myTests.filter((t) => t.status !== "draft").length;
                        return (
                          <tr key={r.id} className="hover:bg-surface-2">
                            <Td className="font-medium">{s.subjectById.get(r.subject_id)?.name}</Td>
                            <Td className="text-sm">{r.staff?.full_name}</Td>
                            <Td className="text-sm">
                              {myTests.length === 0 ? (
                                <span className="text-muted">None yet</span>
                              ) : (
                                <>
                                  <span className="font-semibold">{myTests.length}</span>
                                  {submitted > 0 ? <span className="text-muted"> · {submitted} submitted</span> : null}
                                </>
                              )}
                            </Td>
                            {manage ? (
                              <Td className="text-right">
                                <RemoveButton id={r.id} label={`${s.subjectById.get(r.subject_id)?.name ?? "subject"} from ${r.staff?.full_name ?? "teacher"}`} action={removeAssignment} />
                              </Td>
                            ) : null}
                          </tr>
                        );
                      })}
                    </tbody>
                  </Table>
                </div>
              );
            })}
          </div>
        ) : (
          // By teacher: one section per teacher
          <div className="divide-y divide-border">
            {teacherSorted.map(([teacherId, items]) => {
              const teacherTests = tests.filter((t) => t.created_by === teacherId);
              const totalTests = teacherTests.length;
              const submittedTests = teacherTests.filter((t) => t.status !== "draft").length;
              return (
                <div key={teacherId} className="px-5 py-4">
                  <div className="mb-3 flex items-center justify-between gap-4">
                    <h3 className="font-semibold">{items[0].staff?.full_name}</h3>
                    <span className="text-xs text-muted">
                      {totalTests} test{totalTests === 1 ? "" : "s"} this term
                      {submittedTests > 0 ? ` · ${submittedTests} submitted` : ""}
                    </span>
                  </div>
                  <Table>
                    <thead>
                      <tr>
                        <Th>Subject</Th>
                        <Th>Class</Th>
                        <Th>Tests</Th>
                        <Th>Last created</Th>
                        {manage ? <Th className="w-20" /> : null}
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((r) => {
                        const classObj = s.classes.find((c) => c.id === r.class_id);
                        const yearId = classObj?.year_id ?? "";
                        const myTests = testsByKey.get(`${teacherId}:${r.subject_id}:${yearId}`) ?? [];
                        const lastCreated = myTests[0]?.created_at;
                        return (
                          <tr key={r.id} className="hover:bg-surface-2">
                            <Td className="font-medium">{s.subjectById.get(r.subject_id)?.name}</Td>
                            <Td className="text-sm">{s.className(r.class_id)}</Td>
                            <Td className="text-sm">
                              {myTests.length === 0 ? (
                                <span className="text-muted">None</span>
                              ) : (
                                <>
                                  {myTests.map((t) => (
                                    <div key={t.id}>
                                      <Badge tone={t.status === "approved" ? "success" : t.status === "pending_approval" ? "warning" : "neutral"} className="text-xs">
                                        {t.status === "approved" ? "Approved" : t.status === "pending_approval" ? "Pending" : "Draft"}
                                      </Badge>
                                    </div>
                                  ))}
                                </>
                              )}
                            </Td>
                            <Td className="text-xs text-muted">
                              {lastCreated ? new Date(lastCreated).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "—"}
                            </Td>
                            {manage ? (
                              <Td className="text-right">
                                <RemoveButton id={r.id} label={`${r.staff?.full_name ?? "teacher"} from ${s.subjectById.get(r.subject_id)?.name ?? "subject"} ${s.className(r.class_id)}`} action={removeAssignment} />
                              </Td>
                            ) : null}
                          </tr>
                        );
                      })}
                    </tbody>
                  </Table>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}
