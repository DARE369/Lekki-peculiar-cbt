import { ActionForm, SubmitButton } from "@/components/forms";
import { Field, Input, Select, Textarea } from "@/components/ui";
import type { QuestionOption, Subject, Year } from "@/lib/types";
import { saveQuestion } from "../actions";

export interface QuestionFormValues {
  id?: string;
  subject_id?: string;
  year_id?: string | null;
  body?: string;
  options?: QuestionOption[];
  answer?: string;
  topic?: string | null;
  difficulty?: number | null;
  explanation?: string | null;
  image_url?: string | null;
}

export function QuestionForm({
  subjects,
  years,
  values = {},
  assessmentId,
}: {
  subjects: Subject[];
  years: Year[];
  values?: QuestionFormValues;
  assessmentId?: string;
}) {
  const opt = (k: string) => values.options?.find((o) => o.key === k)?.text ?? "";
  return (
    <ActionForm action={saveQuestion} className="space-y-5" resetOnSuccess={!values.id}>
      {values.id ? <input type="hidden" name="id" value={values.id} /> : null}
      {assessmentId ? <input type="hidden" name="assessment_id" value={assessmentId} /> : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Subject">
          <Select name="subject_id" defaultValue={values.subject_id ?? ""} required disabled={Boolean(values.id)}>
            <option value="" disabled>
              Choose…
            </option>
            {subjects.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
          {values.id ? <input type="hidden" name="subject_id" value={values.subject_id} /> : null}
        </Field>
        <Field label="Year group (optional)">
          <Select name="year_id" defaultValue={values.year_id ?? ""}>
            <option value="">Any</option>
            {years.map((y) => (
              <option key={y.id} value={y.id}>
                {y.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Field label="Question">
        <Textarea name="body" rows={3} required defaultValue={values.body ?? ""} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        {["A", "B", "C", "D", "E", "F"].map((k) => (
          <Field key={k} label={`Option ${k}${k > "D" ? " (optional)" : k > "B" ? "" : ""}`}>
            <Input name={`option_${k}`} defaultValue={opt(k)} required={k <= "B"} />
          </Field>
        ))}
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Correct answer">
          <Select name="answer" defaultValue={values.answer ?? ""} required>
            <option value="" disabled>
              Pick…
            </option>
            {["A", "B", "C", "D", "E", "F"].map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Topic (optional)">
          <Input name="topic" defaultValue={values.topic ?? ""} placeholder="e.g. Photosynthesis" />
        </Field>
        <Field label="Difficulty (optional)">
          <Select name="difficulty" defaultValue={String(values.difficulty ?? "")}>
            <option value="">—</option>
            <option value="1">Easy</option>
            <option value="2">Medium</option>
            <option value="3">Hard</option>
          </Select>
        </Field>
      </div>
      <Field label="Explanation (optional)" hint="Shown to students only if the test is set to show corrections.">
        <Textarea name="explanation" rows={2} defaultValue={values.explanation ?? ""} />
      </Field>
      <Field label="Image link (optional)" hint="A web address of a diagram to show with the question.">
        <Input name="image_url" type="url" defaultValue={values.image_url ?? ""} placeholder="https://…" />
      </Field>
      <div className="flex flex-wrap gap-3">
        <SubmitButton>{values.id ? "Save changes" : "Save question"}</SubmitButton>
        {!values.id && !assessmentId ? (
          <SubmitButton variant="secondary" name="add_another" value="1">
            Save &amp; add another
          </SubmitButton>
        ) : null}
      </div>
    </ActionForm>
  );
}
