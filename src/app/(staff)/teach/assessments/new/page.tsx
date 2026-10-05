import type { Metadata } from "next";
import { FilePlus2 } from "lucide-react";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Alert, Card, EmptyState, Field, Input, LinkButton, PageHeader, Select, Textarea } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { getStructure } from "@/lib/data";
import { teachableSubjects } from "@/lib/scope";
import { createAssessment } from "../../actions";
import { TestTarget, type ClassOption } from "./test-target";
import { TypeFields } from "./type-fields";
import { BatchCreate } from "./batch-create";
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
  // Build a class-first options structure: for each class the teacher can create a test in,
  // list the subjects available for that class.
  const showSection = staff.isAdmin || staff.isSuperAdmin;
  const classMap = new Map<string, ClassOption>();
  for (const sub of subjects) {
    const adminHere = staff.isSuperAdmin || (staff.isAdmin && staff.sectionIds.includes(sub.section_id));
    const assignedClassIds = new Set(
      adminHere
        ? s.classes.filter((c) => c.active && s.sectionOfClass(c.id)?.id === sub.section_id).map((c) => c.id)
        : (mine ?? []).filter((r) => r.subject_id === sub.id).map((r) => r.class_id as string),
    );
    const subjectLabel = showSection ? `${sub.name} (${s.sectionById.get(sub.section_id)?.name})` : sub.name;
    for (const classId of assignedClassIds) {
      const cls = s.classById.get(classId);
      if (!cls || !cls.active) continue;
      const year = s.yearById.get(cls.year_id);
      if (!year) continue;
      if (!classMap.has(classId)) {
        classMap.set(classId, { classId, className: cls.name, yearId: year.id, yearName: year.name, subjects: [] });
      }
      classMap.get(classId)!.subjects.push({ subjectId: sub.id, label: subjectLabel });
    }
  }
  const options: ClassOption[] = [...classMap.values()].sort((a, b) => {
    const al = s.yearById.get(a.yearId)?.level ?? 0;
    const bl = s.yearById.get(b.yearId)?.level ?? 0;
    return al - bl || a.className.localeCompare(b.className);
  });

  // Detect locked mode: coming from upload with subject+year params
  const spSubject = typeof sp.subject === "string" ? sp.subject : undefined;
  const spYear = typeof sp.year === "string" ? sp.year : undefined;
  const locked = Boolean(spSubject && spYear);

  // Resolve defaultClass: explicit param wins; otherwise infer from subject+year
  let defaultClass = typeof sp.class === "string" ? sp.class : undefined;
  if (!defaultClass && spSubject && spYear) {
    defaultClass = options.find(
      (o) => o.yearId === spYear && o.subjects.some((sub) => sub.subjectId === spSubject),
    )?.classId;
  }

  // Batch mode toggle
  const batch = sp.batch === "1";

  // Teachers whose choices are still waiting can't build a test yet, but they can upload questions.
  const { count: waiting } = options.length
    ? { count: 0 }
    : await supabase
        .from("teaching_assignments")
        .select("id", { count: "exact", head: true })
        .eq("teacher_id", staff.id)
        .eq("session_id", s.currentSessionId ?? "")
        .eq("status", "requested");
  return (
    <div className="max-w-2xl space-y-4">
      <PageHeader
        icon={FilePlus2} title="New test or exam" back={{ href: "/teach/assessments", label: "Tests & exams" }} />
      {options.length === 0 ? (
        <Card>
          {waiting ? (
            <EmptyState
              title="Your subjects are waiting for approval"
              action={<LinkButton href="/teach/questions/import">Upload questions</LinkButton>}
            >
              You can make a test once your Head of Section approves your subjects and classes. We&apos;ll email you when that
              happens. Until then, you can upload your questions.
            </EmptyState>
          ) : (
            <EmptyState title="No subjects yet" action={<LinkButton href="/teach/classes">Add what you teach</LinkButton>} />
          )}
        </Card>
      ) : (
        <>
          {!locked ? (
            <div className="flex gap-2">
              <a
                href="/teach/assessments/new"
                className={`rounded-lg border px-3 py-1.5 text-sm font-medium ${!batch ? "border-brand bg-brand-soft text-brand" : "border-border"}`}
              >
                Single test
              </a>
              <a
                href="/teach/assessments/new?batch=1"
                className={`rounded-lg border px-3 py-1.5 text-sm font-medium ${batch ? "border-brand bg-brand-soft text-brand" : "border-border"}`}
              >
                Batch create
              </a>
            </div>
          ) : null}
          {batch && !locked ? (
            <Card className="p-5">
              <BatchCreate options={options} />
            </Card>
          ) : (
            <Card className="p-5">
              <ActionForm action={createAssessment} className="space-y-5">
                <TypeFields />
                <TestTarget
                  options={options}
                  defaultClass={defaultClass}
                  defaultSubjectId={spSubject}
                  locked={locked}
                />
                {!locked ? (
                  <Field label="Title" hint={'Leave blank to use e.g. “Biology Test”.'}>
                    <Input name="title" placeholder="e.g. Biology — First Term Mid-term Test" />
                  </Field>
                ) : null}
                <Field label="Instructions for students" hint="Shown on the start screen before the first question.">
                  <Textarea name="instructions" rows={3} placeholder="Answer all questions. Each question carries equal marks." />
                </Field>
                {/* Term is set by the super admin; teachers always use the current term. */}
                <input type="hidden" name="term_id" value={s.currentTerm?.id ?? ""} />
                {!s.currentTerm ? <Alert tone="warning">No current term is set — ask the super admin to set one before creating a test.</Alert> : null}
                <SubmitButton>Create and add questions</SubmitButton>
              </ActionForm>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
