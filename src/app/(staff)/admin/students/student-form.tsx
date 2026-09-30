import { ActionForm, SubmitButton } from "@/components/forms";
import { Checkbox, Field, Input, Select } from "@/components/ui";
import type { ClassRow } from "@/lib/types";
import { saveStudent } from "./actions";

export interface StudentValues {
  id?: string;
  admission_no?: string;
  first_name?: string;
  last_name?: string;
  other_names?: string | null;
  gender?: string | null;
  class_id?: string | null;
  active?: boolean;
}

export function StudentForm({ classes, values = {} }: { classes: ClassRow[]; values?: StudentValues }) {
  return (
    <ActionForm action={saveStudent} className="space-y-4">
      {values.id ? <input type="hidden" name="id" value={values.id} /> : null}
      <Field label="Admission number" hint="Students type this to log in. Spaces, dashes, slashes and leading zeros don't matter.">
        <Input name="admission_no" defaultValue={values.admission_no} required className="font-mono" />
      </Field>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="First name">
          <Input name="first_name" defaultValue={values.first_name} required />
        </Field>
        <Field label="Other names">
          <Input name="other_names" defaultValue={values.other_names ?? ""} />
        </Field>
        <Field label="Surname">
          <Input name="last_name" defaultValue={values.last_name} required />
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Class">
          <Select name="class_id" defaultValue={values.class_id ?? ""}>
            <option value="">No class</option>
            {classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Gender">
          <Select name="gender" defaultValue={values.gender ?? ""}>
            <option value="">—</option>
            <option value="F">Female</option>
            <option value="M">Male</option>
          </Select>
        </Field>
      </div>
      {values.id ? <Checkbox name="active" label="Active (currently at the school)" defaultChecked={values.active ?? true} /> : null}
      <SubmitButton>{values.id ? "Save" : "Add student"}</SubmitButton>
    </ActionForm>
  );
}
