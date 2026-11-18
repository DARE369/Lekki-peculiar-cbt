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
      <Field label="CA round">
        <input type="hidden" name="sequence_label" value={value} />
        <div className="flex flex-wrap gap-1.5">
          {presets.map((p) => (
            <span
              key={p}
              className={cn(
                "rounded-full border px-3 py-1 text-xs font-semibold",
                value === p ? "border-brand bg-brand text-white" : "border-border text-muted",
              )}
            >
              {p}
            </span>
          ))}
          <span className={cn("rounded-full border px-3 py-1 text-xs font-semibold", value === "" ? "border-brand bg-brand text-white" : "border-border text-muted")}>
            None
          </span>
        </div>
      </Field>
    );
  }

  return (
    <Field
      label="CA round"
      hint={activeRounds.length > 0 ? "Groups this test with others in the same CA round." : "Groups this test with others of the same label this term."}
    >
      <input type="hidden" name="sequence_label" value={value} />
      <div className="flex flex-wrap gap-1.5">
        {presets.map((p) => (
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
