"use client";

import { useState } from "react";
import { Field, cn } from "@/components/ui";

const PRESETS = ["Test 1", "Test 2", "Test 3", "1st CA", "2nd CA", "Mid-Term", "Exam"];

export function SequenceLabelField({ defaultValue = "" }: { defaultValue?: string }) {
  const [value, setValue] = useState(defaultValue);
  return (
    <Field
      label="Sequence / category"
      hint='Groups this test with others of the same label (e.g. all "Test 1" tests this term). Optional — leave blank if you don't need it.'
    >
      <input
        name="sequence_label"
        value={value}
        onChange={(e) => setValue(e.target.value.slice(0, 30))}
        placeholder="e.g. Test 1, Exam, 1st CA"
        maxLength={30}
        className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm focus:border-brand focus:outline-none"
      />
      <div className="mt-2 flex flex-wrap gap-1.5">
        {PRESETS.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => setValue(p)}
            className={cn(
              "rounded-full border px-3 py-1 text-xs font-semibold transition",
              value === p ? "border-brand bg-brand text-white" : "border-border hover:border-brand",
            )}
          >
            {p}
          </button>
        ))}
        {value && !PRESETS.includes(value) ? null : null}
        <button
          type="button"
          onClick={() => setValue("")}
          className={cn(
            "rounded-full border px-3 py-1 text-xs font-semibold transition",
            value === "" ? "border-brand bg-brand text-white" : "border-border hover:border-brand",
          )}
        >
          None
        </button>
      </div>
    </Field>
  );
}
