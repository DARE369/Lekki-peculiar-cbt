import type { Metadata } from "next";
import { FilePlus2 } from "lucide-react";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Alert, Card, EmptyState, Field, Input, LinkButton, PageHeader, Select } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { getStructure } from "@/lib/data";
import { teachableSubjects } from "@/lib/scope";
import { createAssessment } from "../../actions";
import { TestTarget, type TargetOption } from "./test-target";
import { TypeFields } from "./type-fields";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "New test or exam" };

export default async function NewAssessment(props: PageProps<"/teach/assessments/new">) {
  const sp = await props.searchParams;
  const staff = await requireStaff();
  const s = await getStructure();
  const subjects = await teachableSubjects(staff, s);
  // What the teacher can set a test for: their approved subject + class pairs; admins also get every class in their sections.
  const supabase = await createClient();
  const { data: mine } = await supabase
    .from("teaching_assignments")
    .select("subject_id, class_id")
    .eq("teacher_id", staff.id)
    .eq("session_id", s.currentSessionId ?? "")
    .eq("status", "approved");
  const options: TargetOption[] = subjects.map((sub) => {
    const adminHere = staff.isSuperAdmin || (staff.isAdmin && staff.sectionIds.includes(sub.section_id));
    const classIds = new Set(
      adminHere
        ? s.classes.filter((c) => c.active && s.sectionOfClass(c.id)?.id === sub.section_id).map((c) => c.id)
        : (mine ?? []).filter((r) => r.subject_id === sub.id).map((r) => r.class_id as string),
    );
    const years = s.years
      .filter((y) => y.section_id === sub.section_id)
      .map((y) => ({ yearId: y.id, name: y.name, classes: s.classes.filter((c) => c.year_id === y.id && classIds.has(c.id)).map((c) => ({ id: c.id, name: c.name })) }))
      .filter((y) => adminHere || y.classes.length > 0);
    return { subjectId: sub.id, label: `${sub.name} (${s.sectionById.get(sub.section_id)?.name})`, years };
  }).filter((o) => o.years.length > 0);
  return (
    <div className="max-w-2xl">
      <PageHeader
        icon={FilePlus2} title="New test or exam" back={{ href: "/teach/assessments", label: "Tests & exams" }} />
      {options.length === 0 ? (
        <Card>
          <EmptyState title="No subjects yet" action={<LinkButton href="/teach/classes">Add what you teach</LinkButton>} />
        </Card>
      ) : (
        <Card className="p-5">
          <ActionForm action={createAssessment} className="space-y-5">
            <TypeFields />
            <TestTarget
              options={options}
              defaultSubject={typeof sp.subject === "string" ? sp.subject : undefined}
              defaultYear={typeof sp.year === "string" ? sp.year : undefined}
            />
            <Field label="Title" hint="Leave blank to use e.g. “Biology Test”.">
              <Input name="title" placeholder="e.g. Biology — First Term Mid-term Test" />
            </Field>
            <Field label="Term">
              <Select name="term_id" defaultValue={s.currentTerm?.id}>
                {s.terms.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.session_name} · {t.name}
                  </option>
                ))}
              </Select>
            </Field>
            {!s.currentTerm ? <Alert tone="warning">No current term is set — ask the super admin.</Alert> : null}
            <SubmitButton>Create and add questions</SubmitButton>
          </ActionForm>
        </Card>
      )}
    </div>
  );
}
