"use client";

import { useState } from "react";
import { Field, Select, cn } from "@/components/ui";

export type ClassOption = {
  classId: string;
  className: string;
  yearId: string;
  yearName: string;
  subjects: { subjectId: string; label: string }[];
};

export function TestTarget({
  options,
  defaultClass,
  defaultSubjectId,
  locked,
}: {
  options: ClassOption[];
  defaultClass?: string;
  defaultSubjectId?: string;
  locked?: boolean;
}) {
  const [classId, setClassId] = useState(
    options.some((o) => o.classId === defaultClass) ? defaultClass! : options.length === 1 ? options[0].classId : "",
  );
  const cls = options.find((o) => o.classId === classId);

  const [subjectId, setSubjectId] = useState(() => {
    if (defaultSubjectId && cls?.subjects.some((s) => s.subjectId === defaultSubjectId)) return defaultSubjectId;
    return cls?.subjects.length === 1 ? cls.subjects[0].subjectId : "";
  });

  function handleClassChange(newClassId: string) {
    const newCls = options.find((o) => o.classId === newClassId);
    setClassId(newClassId);
    setSubjectId(newCls?.subjects.length === 1 ? newCls.subjects[0].subjectId : "");
  }

  // Other classes in the same year that also offer the chosen subject
  const siblings = cls && subjectId
    ? options.filter((o) => o.yearId === cls.yearId && o.classId !== cls.classId && o.subjects.some((s) => s.subjectId === subjectId))
    : [];

  if (locked && cls && subjectId) {
    const sub = cls.subjects.find((s) => s.subjectId === subjectId);
    return (
      <div className="space-y-3">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Class">
            <p className="flex h-10 items-center rounded-lg border border-border bg-surface-2 px-3 text-sm font-medium">{cls.className} — {cls.yearName}</p>
          </Field>
          <Field label="Subject">
            <p className="flex h-10 items-center rounded-lg border border-border bg-surface-2 px-3 text-sm font-medium">{sub?.label ?? subjectId}</p>
          </Field>
        </div>
        <input type="hidden" name="subject_id" value={subjectId} />
        <input type="hidden" name="year_id" value={cls.yearId} />
        <input type="hidden" name="class_id" value={cls.classId} />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Class">
          <Select value={classId} onChange={(e) => handleClassChange(e.target.value)} required>
            <option value="" disabled>Choose…</option>
            {options.map((o) => (
              <option key={o.classId} value={o.classId}>
                {o.className} — {o.yearName}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Subject">
          <Select
            name="subject_id"
            required
            value={subjectId}
            onChange={(e) => setSubjectId(e.target.value)}
            disabled={!cls}
          >
            <option value="" disabled>{cls ? "Choose…" : "Pick a class first"}</option>
            {(cls?.subjects ?? []).map((s) => (
              <option key={s.subjectId} value={s.subjectId}>{s.label}</option>
            ))}
          </Select>
        </Field>
      </div>

      {/* Hidden year — auto-derived from class */}
      {cls ? <input type="hidden" name="year_id" value={cls.yearId} /> : null}

      {cls && subjectId ? (
        <fieldset key={`${classId}:${subjectId}`}>
          <legend className="mb-1 text-sm font-medium">Which classes is it for?</legend>
          {siblings.length > 0 ? (
            <p className="mb-2 text-xs text-muted">Untick any that won't take this test.</p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <label className={cn(
              "flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border-2 px-4 text-sm font-semibold",
              "border-border has-checked:border-brand has-checked:bg-brand-soft",
            )}>
              <input type="checkbox" name="class_id" value={cls.classId} defaultChecked className="size-4 accent-[var(--brand)]" />
              {cls.className}
            </label>
            {siblings.map((sib) => (
              <label key={sib.classId} className={cn(
                "flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border-2 px-4 text-sm font-semibold",
                "border-border has-checked:border-brand has-checked:bg-brand-soft",
              )}>
                <input type="checkbox" name="class_id" value={sib.classId} className="size-4 accent-[var(--brand)]" />
                {sib.className}
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}
    </div>
  );
}
