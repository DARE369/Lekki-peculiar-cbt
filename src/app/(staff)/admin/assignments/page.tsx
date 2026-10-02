import type { Metadata } from "next";
import { Users } from "lucide-react";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Alert, Badge, Card, CardHeader, EmptyState, Field, PageHeader, Select, Table, Td, Th } from "@/components/ui";
import { can, requireAdmin } from "@/lib/auth";
import { getStructure } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";
import { assignTeacher, decideAssignment, removeAssignment } from "../actions";

export const metadata: Metadata = { title: "Teaching assignments" };

export default async function AssignmentsPage(props: PageProps<"/admin/assignments">) {
  const sp = await props.searchParams;
  const staff = await requireAdmin();
  const s = await getStructure();
  const supabase = await createClient();
  const [{ data: rows }, { data: teachers }] = await Promise.all([
    supabase
      .from("teaching_assignments")
      .select("id, teacher_id, subject_id, class_id, status, staff:teacher_id(full_name)")
      .eq("session_id", s.currentSessionId ?? ""),
    supabase.from("staff").select("id, full_name").eq("active", true).order("full_name"),
  ]);
  const manage = can(staff, "teachers.manage");
  const mySections = new Set(staff.isSuperAdmin ? s.sections.map((x) => x.id) : staff.sectionIds);
  const myClasses = s.classes.filter((c) => c.active && mySections.has(s.sectionOfClass(c.id)?.id ?? ""));
  const mySubjects = s.subjects.filter((x) => x.active && mySections.has(x.section_id));
  type Row = { id: string; teacher_id: string; subject_id: string; class_id: string; status: string; staff: { full_name: string } | null };
  const all = (rows ?? []) as unknown as Row[];
  const requested = all.filter((r) => r.status === "requested");
  const view = sp.view === "teacher" ? "teacher" : "class";
  const approved = all.filter((r) => r.status === "approved");
  const groups = new Map<string, Row[]>();
  for (const r of approved) {
    const k = view === "class" ? r.class_id : r.teacher_id;
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  const sortedGroups = [...groups.entries()].sort((a, b) =>
    view === "class"
      ? s.className(a[0]).localeCompare(s.className(b[0]), undefined, { numeric: true })
      : (a[1][0].staff?.full_name ?? "").localeCompare(b[1][0].staff?.full_name ?? ""),
  );

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Users}
        title="Teaching assignments"
        description={`Who teaches what in ${s.currentTerm?.session_name ?? "this session"}. Teachers only see students and results for their approved classes.`}
      />
      {!manage ? <Alert tone="warning">You can view assignments but need the “Approve teaching assignments” permission to change them.</Alert> : null}

      <Card>
        <CardHeader title={`Requests (${requested.length})`} />
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
                <SubmitButton name="decision" value="approve" size="sm">
                  Approve ticked
                </SubmitButton>
                <SubmitButton name="decision" value="reject" size="sm" variant="secondary">
                  Decline ticked
                </SubmitButton>
              </div>
            ) : null}
          </form>
        )}
      </Card>

      {manage ? (
        <Card>
          <CardHeader title="Assign a teacher directly" />
          <ActionForm action={assignTeacher} className="space-y-4 p-5" resetOnSuccess>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Teacher">
                <Select name="teacher_id" required defaultValue="">
                  <option value="" disabled>
                    Choose…
                  </option>
                  {(teachers ?? []).map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.full_name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Subject">
                <Select name="subject_id" required defaultValue="">
                  <option value="" disabled>
                    Choose…
                  </option>
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

      <Card>
        <CardHeader
          title="Current assignments"
          actions={
            <div className="flex gap-1 text-sm">
              <a href="?view=class" className={view === "class" ? "font-semibold text-brand" : "text-muted"}>
                By class
              </a>
              <span className="text-muted">·</span>
              <a href="?view=teacher" className={view === "teacher" ? "font-semibold text-brand" : "text-muted"}>
                By teacher
              </a>
            </div>
          }
        />
        {sortedGroups.length === 0 ? (
          <EmptyState title="No approved assignments yet" />
        ) : (
          <ul className="divide-y divide-border">
            {sortedGroups.map(([key, items]) => (
              <li key={key} className="px-5 py-3">
                <p className="font-medium">{view === "class" ? s.className(key) : items[0].staff?.full_name}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {items.map((r) => (
                    <span key={r.id} className="inline-flex items-center gap-1.5">
                      <Badge tone="brand">
                        {s.subjectById.get(r.subject_id)?.name} · {view === "class" ? r.staff?.full_name : s.className(r.class_id)}
                      </Badge>
                      {manage ? (
                        <form action={removeAssignment}>
                          <input type="hidden" name="id" value={r.id} />
                          <button className="text-xs text-muted hover:text-danger" aria-label="Remove">
                            ✕
                          </button>
                        </form>
                      ) : null}
                    </span>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

