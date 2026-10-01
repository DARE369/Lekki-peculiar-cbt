import type { Metadata } from "next";
import { FilePlus2 } from "lucide-react";
import { Card, PageHeader } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { getStructure } from "@/lib/data";
import { teachableSubjects } from "@/lib/scope";
import { QuestionForm } from "../question-form";

export const metadata: Metadata = { title: "Add question" };

export default async function NewQuestion(props: PageProps<"/teach/questions/new">) {
  const sp = await props.searchParams;
  const staff = await requireStaff();
  const s = await getStructure();
  const subjects = await teachableSubjects(staff, s, { includeRequested: true });
  const subjectId = typeof sp.subject === "string" ? sp.subject : undefined;
  const assessmentId = typeof sp.assessment === "string" ? sp.assessment : undefined;
  const sectionIds = new Set(subjects.map((x) => x.section_id));
  return (
    <div className="max-w-3xl">
      <PageHeader
        icon={FilePlus2}
        title="Add a question"
        back={assessmentId ? { href: `/teach/assessments/${assessmentId}`, label: "Back to test" } : { href: "/teach/questions", label: "Question bank" }}
      />
      <Card className="p-5">
        <QuestionForm
          subjects={subjects}
          years={s.years.filter((y) => sectionIds.has(y.section_id))}
          values={{ subject_id: subjectId }}
          assessmentId={assessmentId}
        />
      </Card>
    </div>
  );
}
