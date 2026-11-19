"use client";

import { useState } from "react";
import { Field, cn } from "@/components/ui";
import type { RoundConfig } from "@/lib/data";

const FALLBACK_PRESETS = ["Test 1", "Test 2", "Test 3", "1st CA", "2nd CA", "Mid-Term", "Exam"];

export function RoundField({
  rounds,
  defaultValue,
  disabled,
}: {
  rounds: RoundConfig[];
  defaultValue: string | null;
  disabled?: boolean;
}) {
  const activeRounds = rounds.filter((r) => r.is_active);
  const presets = activeRounds.length > 0 ? activeRounds.map((r) => r.label) : FALLBACK_PRESETS;
  const [value, setValue] = useState(defaultValue ?? "");

  if (disabled) {
    return (
      <Field label="Round">
        <input type="hidden" name="sequence_label" value={value} />
        <div className="flex flex-wrap gap-1.5">
          {presets.map((p) => (
            <span
              key={p}
              className={cn(
                "rounded-md border px-2.5 py-1 text-xs font-medium",
                value === p ? "border-brand bg-brand text-white" : "border-border text-muted",
              )}
            >
              {p}
            </span>
          ))}
          <span className={cn("rounded-md border px-2.5 py-1 text-xs font-medium", value === "" ? "border-brand bg-brand text-white" : "border-border text-muted")}>
            None
          </span>
        </div>
      </Field>
    );
  }

  return (
    <Field
      label="Round"
      hint={activeRounds.length > 0 ? "Which round this test is for (1st CA, Exam…)." : "Groups this test with others of the same label this term."}
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
