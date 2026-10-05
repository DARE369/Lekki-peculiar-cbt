"use client";

import { useState } from "react";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Field, Input, Select, Textarea, cn } from "@/components/ui";
import { createBatchAssessments } from "../../actions";
import type { ClassOption } from "./test-target";

export function BatchCreate({ options }: { options: ClassOption[] }) {
  const [checked, setChecked] = useState<Set<string>>(new Set());

  function toggle(key: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }

  function toggleAll() {
    const allKeys = options.flatMap((o) => o.subjects.map((s) => `${o.classId}:${s.subjectId}`));
    setChecked(checked.size === allKeys.length ? new Set() : new Set(allKeys));
  }

  const allKeys = options.flatMap((o) => o.subjects.map((s) => `${o.classId}:${s.subjectId}`));

  return (
    <ActionForm action={createBatchAssessments} className="space-y-5">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted">Tick the class + subject combos to create tests for.</p>
        <button
          type="button"
          onClick={toggleAll}
          className="text-xs font-semibold text-brand hover:underline"
        >
          {checked.size === allKeys.length ? "Deselect all" : "Select all"}
        </button>
      </div>
      <div className="space-y-3">
        {options.map((o) => (
          <div key={o.classId}>
            <p className="mb-1 text-xs font-semibold text-muted uppercase tracking-wide">{o.className} — {o.yearName}</p>
            <div className="flex flex-wrap gap-2">
              {o.subjects.map((s) => {
                const key = `${o.classId}:${s.subjectId}`;
                const on = checked.has(key);
                return (
                  <label
                    key={key}
                    className={cn(
                      "flex min-h-10 cursor-pointer items-center gap-2 rounded-xl border-2 px-3 text-sm font-medium",
                      on ? "border-brand bg-brand-soft" : "border-border",
                    )}
                  >
                    <input
                      type="checkbox"
                      name="pick"
                      value={key}
                      checked={on}
                      onChange={() => toggle(key)}
                      className="size-4 accent-[var(--brand)]"
                    />
                    {s.label}
                  </label>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Type">
          <Select name="type" defaultValue="test">
            <optgroup label="Live">
              <option value="test">Test</option>
              <option value="exam">Exam</option>
            </optgroup>
            <optgroup label="Mock">
              <option value="mock_test">Test mock</option>
              <option value="mock">Exam mock</option>
            </optgroup>
          </Select>
        </Field>
      </div>
      <Field label="Instructions for students" hint="Shown on the start screen. Applied to all created tests.">
        <Textarea name="instructions" rows={2} defaultValue="Answer all questions." placeholder="Answer all questions. Each question carries equal marks." />
      </Field>
      <SubmitButton>
        Create {checked.size > 0 ? `${checked.size} test${checked.size === 1 ? "" : "s"}` : "tests"}
      </SubmitButton>
    </ActionForm>
  );
}
