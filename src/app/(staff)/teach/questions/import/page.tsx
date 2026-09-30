import type { Metadata } from "next";
import { Card, EmptyState, LinkButton, PageHeader } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { getStructure } from "@/lib/data";
import { teachableSubjects } from "@/lib/scope";
import { createClient } from "@/lib/supabase/server";
import { ImportWizard } from "./import-wizard";

export const metadata: Metadata = { title: "Upload questions" };

export default async function ImportPage(props: PageProps<"/teach/questions/import">) {
  const sp = await props.searchParams;
  const staff = await requireStaff();
  const s = await getStructure();
  const subjects = await teachableSubjects(staff, s);
  let subjectId = typeof sp.subject === "string" ? sp.subject : undefined;
  const assessmentId = typeof sp.assessment === "string" ? sp.assessment : undefined;
  if (assessmentId) {
    const supabase = await createClient();
    const { data } = await supabase.from("assessments").select("subject_id").eq("id", assessmentId).maybeSingle();
    subjectId = data?.subject_id ?? subjectId;
  }
  return (
    <div>
      <PageHeader
        title="Upload questions"
        description="Questions are checked before anything is saved. Duplicates already in the bank are skipped."
        back={assessmentId ? { href: `/teach/assessments/${assessmentId}`, label: "Back to test" } : { href: "/teach/questions", label: "Question bank" }}
      />
      {subjects.length === 0 ? (
        <Card>
          <EmptyState title="No subjects yet" action={<LinkButton href="/teach/classes">Add what you teach</LinkButton>} />
        </Card>
      ) : (
        <ImportWizard subjects={subjects} years={s.years} defaultSubject={subjectId} assessmentId={assessmentId} />
      )}
    </div>
  );
}
