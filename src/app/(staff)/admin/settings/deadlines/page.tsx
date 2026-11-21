import type { Metadata } from "next";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Card, CardHeader, Field, Input, PageHeader } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { getStructure } from "@/lib/data";
import { getQuestionSettings } from "@/lib/onboarding";
import { saveDeadlines } from "../../progress/actions";
import { SettingsNav } from "../settings-nav";

export const metadata: Metadata = { title: "Question deadlines" };

export default async function DeadlinesPage() {
  const me = await requireAdmin();
  const s = await getStructure();
  const settings = await getQuestionSettings();
  const sections = s.sections.filter((x) => x.cbt_enabled && (me.isSuperAdmin || me.sectionIds.includes(x.id)));
  return (
    <div className="max-w-3xl">
      <PageHeader title="Question deadlines" description="Part of Settings. Changes apply to the sections you look after." />
      <SettingsNav staff={me} active="deadlines" />
      <Card>
        <CardHeader
          title="Question deadlines"
          description={`The date teachers should have their questions uploaded and tests sent for review. Teachers see it on their dashboard. A section date overrides the school date for that section.${me.isSuperAdmin ? "" : " You can set the date for your section."}`}
        />
        <ActionForm action={saveDeadlines} className="space-y-4 p-5">
          <div className="grid gap-4 sm:grid-cols-2">
            {me.isSuperAdmin ? (
              <Field label="Whole school">
                <Input name="school_deadline" type="date" defaultValue={settings.defaultDeadline ?? ""} />
              </Field>
            ) : null}
            {sections.map((sec) => (
              <Field key={sec.id} label={sec.name} hint={me.isSuperAdmin ? "Leave empty to use the school date." : undefined}>
                <Input name={`section_${sec.id}`} type="date" defaultValue={sec.question_deadline ?? ""} />
              </Field>
            ))}
          </div>
          <SubmitButton>Save deadlines</SubmitButton>
        </ActionForm>
      </Card>
    </div>
  );
}
