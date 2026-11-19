"use client";

import { useState } from "react";
import { Field, cn } from "@/components/ui";
import type { RoundConfig } from "@/lib/data";

const FALLBACK_PRESETS = ["Test 1", "Test 2", "Test 3", "1st CA", "2nd CA", "Mid-Term", "Exam"];

interface Props {
  rounds?: RoundConfig[];
  defaultValue?: string;
}

export function SequenceLabelField({ rounds = [], defaultValue }: Props) {
  const activeRounds = rounds.filter((r) => r.is_active);
  const presets = activeRounds.length > 0 ? activeRounds.map((r) => r.label) : FALLBACK_PRESETS;
  const resolved = defaultValue ?? (activeRounds.find((r) => r.is_default)?.label ?? "");
  const [value, setValue] = useState(resolved);

  if (activeRounds.length > 0) {
    // Controlled vocabulary: teacher picks from the configured list.
    return (
      <Field
        label="Round"
        hint="Which round this test is for (1st CA, Exam…). Set by your administrator."
      >
        <input type="hidden" name="sequence_label" value={value} />
        <div className="flex flex-wrap gap-1.5">
          {presets.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setValue(p)}
              className={cn(
                "rounded-md border px-2.5 py-1 text-xs font-medium transition",
                value === p ? "border-brand bg-brand text-white" : "border-border hover:border-brand",
              )}
            >
              {p}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setValue("")}
            className={cn(
              "rounded-md border px-2.5 py-1 text-xs font-medium transition",
              value === "" ? "border-brand bg-brand text-white" : "border-border hover:border-brand",
            )}
          >
            None
          </button>
        </div>
      </Field>
    );
  }

  // Fallback: no rounds configured — free text with preset buttons.
  return (
    <Field
      label="Sequence / category"
      hint="Groups this test with others of the same label (e.g. all &quot;Test 1&quot; tests this term). Optional — leave blank if you don't need it."
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
        {FALLBACK_PRESETS.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => setValue(p)}
            className={cn(
              "rounded-md border px-2.5 py-1 text-xs font-medium transition",
              value === p ? "border-brand bg-brand text-white" : "border-border hover:border-brand",
            )}
          >
            {p}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setValue("")}
          className={cn(
            "rounded-md border px-2.5 py-1 text-xs font-medium transition",
            value === "" ? "border-brand bg-brand text-white" : "border-border hover:border-brand",
          )}
        >
          None
        </button>
      </div>
    </Field>
  );
}
