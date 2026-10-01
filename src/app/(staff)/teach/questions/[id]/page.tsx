import type { Metadata } from "next";
import { FileQuestion } from "lucide-react";
import { notFound } from "next/navigation";
import { Alert, Card, PageHeader } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { getStructure } from "@/lib/data";
import { teachableSubjects } from "@/lib/scope";
import { createClient } from "@/lib/supabase/server";
import { QuestionForm } from "../question-form";

export const metadata: Metadata = { title: "Edit question" };

export default async function EditQuestion(props: PageProps<"/teach/questions/[id]">) {
  const { id } = await props.params;
  const staff = await requireStaff();
  const s = await getStructure();
  const supabase = await createClient();
  const { data: q } = await supabase.from("questions").select("*").eq("id", id).maybeSingle();
  if (!q) notFound();
  const subjects = await teachableSubjects(staff, s, { includeRequested: true });
  const allSubjects = subjects.some((x) => x.id === q.subject_id) ? subjects : [...subjects, s.subjectById.get(q.subject_id)!];
  const canEdit = q.owner_id === staff.id || staff.isAdmin;
  return (
    <div className="max-w-3xl space-y-4">
      <PageHeader
        icon={FileQuestion} title="Edit question" back={{ href: `/teach/questions?subject=${q.subject_id}`, label: "Question bank" }} />
      <Alert tone="info">
        Tests that are already approved keep their own frozen copy, so editing here won&apos;t change a test students are sitting.
        To fix a wrong answer after an exam, use <strong>Fix answer key</strong> in that test&apos;s question analysis.
      </Alert>
      {!canEdit ? <Alert tone="warning">Only the teacher who added this question (or an admin) can edit it.</Alert> : null}
      <Card className="p-5">
        <QuestionForm
          subjects={allSubjects}
          years={s.years.filter((y) => y.section_id === s.subjectById.get(q.subject_id)?.section_id)}
          values={q}
        />
      </Card>
    </div>
  );
}
