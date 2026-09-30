import type { Metadata } from "next";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Alert, Card, EmptyState, Field, Input, LinkButton, PageHeader, Select } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { getStructure } from "@/lib/data";
import { teachableSubjects } from "@/lib/scope";
import { TYPE_DEFAULTS } from "@/lib/types";
import { createAssessment } from "../../actions";

export const metadata: Metadata = { title: "New test or exam" };

export default async function NewAssessment() {
  const staff = await requireStaff();
  const s = await getStructure();
  const subjects = await teachableSubjects(staff, s);
  const sectionIds = new Set(subjects.map((x) => x.section_id));
  return (
    <div className="max-w-2xl">
      <PageHeader title="New test or exam" back={{ href: "/teach/assessments", label: "Tests & exams" }} />
      {subjects.length === 0 ? (
        <Card>
          <EmptyState title="No subjects yet" action={<LinkButton href="/teach/classes">Add what you teach</LinkButton>} />
        </Card>
      ) : (
        <Card className="p-5">
          <ActionForm action={createAssessment} className="space-y-5">
            <Field label="Type">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {(Object.keys(TYPE_DEFAULTS) as (keyof typeof TYPE_DEFAULTS)[]).map((t, i) => (
                  <label
                    key={t}
                    className="flex cursor-pointer flex-col rounded-lg border border-border px-3 py-2 text-sm has-checked:border-brand has-checked:bg-brand-soft"
                  >
                    <span className="flex items-center gap-2 font-medium">
                      <input type="radio" name="type" value={t} defaultChecked={i === 0} className="accent-[var(--brand)]" />
                      {TYPE_DEFAULTS[t].label}
                    </span>
                    <span className="text-xs text-muted">
                      {TYPE_DEFAULTS[t].questions} questions · {TYPE_DEFAULTS[t].minutes} min
                    </span>
                  </label>
                ))}
              </div>
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Subject">
                <Select name="subject_id" required defaultValue="">
                  <option value="" disabled>
                    Choose…
                  </option>
                  {subjects.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name} ({s.sectionById.get(x.section_id)?.name})
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Year group">
                <Select name="year_id" required defaultValue="">
                  <option value="" disabled>
                    Choose…
                  </option>
                  {s.years
                    .filter((y) => sectionIds.has(y.section_id))
                    .map((y) => (
                      <option key={y.id} value={y.id}>
                        {y.name}
                      </option>
                    ))}
                </Select>
              </Field>
            </div>
            <Field label="Title" hint="Leave blank to use e.g. “Biology Test”.">
              <Input name="title" placeholder="e.g. Biology — First Term Mid-term Test" />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Number of questions" hint="Leave blank for the default (20 for tests, 40 for exams).">
                <Input name="question_count" type="number" min={1} max={200} />
              </Field>
              <Field label="Time allowed (minutes)">
                <Input name="duration_minutes" type="number" min={1} max={600} />
              </Field>
            </div>
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
