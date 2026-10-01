"use client";

import { useState } from "react";
import { Field, Select } from "@/components/ui";

export type TargetOption = {
  subjectId: string;
  label: string;
  years: { yearId: string; name: string; classes: { id: string; name: string }[] }[];
};

/** Subject → year group → which of the teacher's classes (arms) the test is for. */
export function TestTarget({ options }: { options: TargetOption[] }) {
  const [subjectId, setSubjectId] = useState(options.length === 1 ? options[0].subjectId : "");
  const subject = options.find((o) => o.subjectId === subjectId);
  const [yearId, setYearId] = useState(subject?.years.length === 1 ? subject.years[0].yearId : "");
  const year = subject?.years.find((y) => y.yearId === yearId);

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Subject">
          <Select
            name="subject_id"
            required
            value={subjectId}
            onChange={(e) => {
              const next = options.find((o) => o.subjectId === e.target.value);
              setSubjectId(e.target.value);
              setYearId(next?.years.length === 1 ? next.years[0].yearId : "");
            }}
          >
            <option value="" disabled>
              Choose…
            </option>
            {options.map((o) => (
              <option key={o.subjectId} value={o.subjectId}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Year group">
          <Select name="year_id" required value={yearId} onChange={(e) => setYearId(e.target.value)} disabled={!subject}>
            <option value="" disabled>
              {subject ? "Choose…" : "Choose a subject first"}
            </option>
            {(subject?.years ?? []).map((y) => (
              <option key={y.yearId} value={y.yearId}>
                {y.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      {year ? (
        <fieldset key={`${subjectId}:${yearId}`}>
          <legend className="mb-1 text-sm font-medium">Which classes is it for?</legend>
          <p className="mb-2 text-xs text-muted">Your Head of Section schedules it for these classes. Untick any that won&apos;t take it.</p>
          {year.classes.length === 0 ? (
            <p className="text-sm text-muted">No classes in this year group yet.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {year.classes.map((c) => (
                <label
                  key={c.id}
                  className="flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border-2 border-border px-4 text-sm font-semibold has-checked:border-brand has-checked:bg-brand-soft"
                >
                  <input type="checkbox" name="class_id" value={c.id} defaultChecked className="size-4 accent-[var(--brand)]" />
                  {c.name}
                </label>
              ))}
            </div>
          )}
        </fieldset>
      ) : null}
    </div>
  );
}
