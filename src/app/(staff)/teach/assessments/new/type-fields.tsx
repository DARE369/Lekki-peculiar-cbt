"use client";

import { useState } from "react";
import { Field, Input, cn } from "@/components/ui";
import { TYPE_DEFAULTS, type AssessmentType } from "@/lib/types";

const GROUPS: { title: string; hint: string; types: AssessmentType[] }[] = [
  { title: "Live", hint: "Counts towards results", types: ["test", "exam"] },
  { title: "Mock", hint: "Practice run before the real one", types: ["mock_test", "mock"] },
];
const QUESTION_CHIPS = [10, 20, 30, 40, 50, 60];
const MINUTE_CHIPS = [15, 30, 45, 60, 90, 120];

/** Type (Live: Test/Exam, Mock: Test mock/Exam mock), then questions and time — prefilled from the type, freely changeable. */
export function TypeFields() {
  const [type, setType] = useState<AssessmentType>("test");
  const [questions, setQuestions] = useState(String(TYPE_DEFAULTS.test.questions));
  const [minutes, setMinutes] = useState(String(TYPE_DEFAULTS.test.minutes));

  function choose(t: AssessmentType) {
    setType(t);
    setQuestions(String(TYPE_DEFAULTS[t].questions));
    setMinutes(String(TYPE_DEFAULTS[t].minutes));
  }

  return (
    <div className="space-y-5">
      <input type="hidden" name="type" value={type} />
      <fieldset>
        <legend className="mb-2 text-sm font-medium">What kind is it?</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          {GROUPS.map((g) => (
            <div key={g.title} className="rounded-2xl border border-border p-3">
              <p className="text-sm font-semibold">
                {g.title} <span className="font-normal text-muted">· {g.hint}</span>
              </p>
              <div className="mt-2 grid grid-cols-2 gap-2">
                {g.types.map((t) => (
                  <button
                    key={t}
                    type="button"
                    aria-pressed={type === t}
                    onClick={() => choose(t)}
                    className={cn(
                      "rounded-xl border-2 px-3 py-2.5 text-left transition",
                      type === t ? "border-brand bg-brand-soft" : "border-border hover:border-brand/50",
                    )}
                  >
                    <span className="block text-sm font-semibold">{TYPE_DEFAULTS[t].label}</span>
                    <span className="block text-xs text-muted">
                      {TYPE_DEFAULTS[t].questions} questions · {TYPE_DEFAULTS[t].minutes} min
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </fieldset>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Number of questions" hint="Questions each student answers. Add more to the test than this and each student gets a random set.">
          <Input name="question_count" type="number" min={1} max={200} required value={questions} onChange={(e) => setQuestions(e.target.value)} />
          <Chips values={QUESTION_CHIPS} current={questions} onPick={setQuestions} />
        </Field>
        <Field label="Time allowed (minutes)">
          <Input name="duration_minutes" type="number" min={1} max={600} required value={minutes} onChange={(e) => setMinutes(e.target.value)} />
          <Chips values={MINUTE_CHIPS} current={minutes} onPick={setMinutes} format={(m) => (m >= 60 && m % 60 === 0 ? `${m / 60} hr` : m > 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m} min`)} />
        </Field>
      </div>
    </div>
  );
}

function Chips({ values, current, onPick, format }: { values: number[]; current: string; onPick: (v: string) => void; format?: (v: number) => string }) {
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {values.map((v) => (
        <button
          key={v}
          type="button"
          onClick={() => onPick(String(v))}
          className={cn(
            "rounded-full border px-3 py-1 text-xs font-semibold",
            current === String(v) ? "border-brand bg-brand text-white" : "border-border hover:border-brand",
          )}
        >
          {format ? format(v) : v}
        </button>
      ))}
    </div>
  );
}
