"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Checkbox, Field, Input, Select, Textarea, cn } from "@/components/ui";
import type { RoundConfig } from "@/lib/data";
import { TYPE_DEFAULTS, markingSummary, type AssessmentSettings, type AssessmentType } from "@/lib/types";
import { updateAssessmentSettings } from "../../actions";
import { RoundField } from "./round-field";
import { TopicField } from "./topic-field";

type Values = {
  id: string;
  title: string;
  sequence_label: string | null;
  topic: string | null;
  type: AssessmentType;
  question_count: number;
  duration_minutes: number;
  settings: AssessmentSettings;
};

type SaveState = { kind: "idle" } | { kind: "saving" } | { kind: "saved"; at: string } | { kind: "error"; text: string } | { kind: "held"; text: string };

/**
 * The test's settings. Everything saves by itself a moment after you stop typing — there is no Save button.
 * Nothing is saved while a required field (the title) is empty; the panel says so instead.
 */
export function SettingsPanel({
  values: v,
  rounds,
  subjectName,
  editable,
}: {
  values: Values;
  rounds: RoundConfig[];
  subjectName: string;
  editable: boolean;
}) {
  const form = useRef<HTMLFormElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [state, setState] = useState<SaveState>({ kind: "idle" });
  const [, start] = useTransition();

  const [type, setType] = useState<AssessmentType>(v.type);
  const [questions, setQuestions] = useState(String(v.question_count));
  const [minutes, setMinutes] = useState(String(v.duration_minutes));
  const [offer, setOffer] = useState<AssessmentType | null>(null);
  const [marksMode, setMarksMode] = useState<"per_question" | "total">(v.settings.marks_mode ?? "per_question");
  const [perQ, setPerQ] = useState(String(v.settings.marks_per_question ?? 1));
  const [total, setTotal] = useState(v.settings.total_marks ? String(v.settings.total_marks) : "");

  useEffect(() => () => (timer.current ? clearTimeout(timer.current) : undefined), []);

  function save() {
    const el = form.current;
    if (!el || !editable) return;
    const fd = new FormData(el);
    if (!String(fd.get("title") ?? "").trim()) {
      setState({ kind: "held", text: "Not saved: the title is required." });
      return;
    }
    setState({ kind: "saving" });
    start(async () => {
      const res = await updateAssessmentSettings(null, fd);
      if (res?.ok) setState({ kind: "saved", at: new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) });
      else setState({ kind: "error", text: res && !res.ok ? res.error : "Couldn't save." });
    });
  }

  /** Save shortly after the last change (typing, ticking, choosing a round chip). */
  function schedule() {
    if (!editable) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(save, 700);
  }

  function chooseType(next: AssessmentType) {
    const prev = TYPE_DEFAULTS[type];
    setType(next);
    const d = TYPE_DEFAULTS[next];
    const untouched = Number(questions) === prev.questions && Number(minutes) === prev.minutes;
    if (untouched) {
      setQuestions(String(d.questions));
      setMinutes(String(d.minutes));
      setOffer(null);
    } else if (Number(questions) !== d.questions || Number(minutes) !== d.minutes) {
      // The teacher typed their own numbers: ask before replacing them.
      setOffer(next);
    }
    schedule();
  }

  const summary = markingSummary(
    { marks_mode: marksMode, marks_per_question: Number(perQ.replace(",", ".")) || 1, total_marks: Number(total.replace(",", ".")) || null },
    Number(questions) || 0,
  );

  return (
    <form ref={form} onInput={schedule} onChange={schedule} onClick={(e) => (e.target as HTMLElement).closest("button") && schedule()} onSubmit={(e) => e.preventDefault()}>
      <input type="hidden" name="id" value={v.id} />
      <div className="flex items-center justify-between gap-3 px-5 pt-4 text-xs" aria-live="polite">
        <span className="text-muted">{editable ? "Changes save by themselves." : null}</span>
        <SaveNote state={state} />
      </div>
      <fieldset disabled={!editable} className="space-y-4 p-5 pt-3">
        <Field label="Title">
          <Input name="title" defaultValue={v.title} required aria-required />
        </Field>
        <RoundField rounds={rounds} defaultValue={v.sequence_label} disabled={!editable} />
        <TopicField defaultValue={v.topic ?? ""} subjectName={subjectName} editable={editable} />

        <Field label="Type">
          <Select name="type" value={type} onChange={(e) => chooseType(e.target.value as AssessmentType)}>
            <optgroup label="Counts towards results">
              <option value="test">Test (usually 20 questions, 30 min)</option>
              <option value="exam">Exam (usually 40 questions, 60 min)</option>
            </optgroup>
            <optgroup label="Practice run">
              <option value="mock_test">Test mock</option>
              <option value="mock">Exam mock</option>
            </optgroup>
            {v.type === "practice" ? <option value="practice">Practice</option> : null}
          </Select>
        </Field>
        {offer ? (
          <div className="rounded-md border border-border bg-surface-2 p-3 text-sm" role="status">
            <p>
              Use the {TYPE_DEFAULTS[offer].label.toLowerCase()} defaults ({TYPE_DEFAULTS[offer].questions} questions, {TYPE_DEFAULTS[offer].minutes} min) instead of your
              numbers?
            </p>
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                className="h-8 rounded-md bg-brand px-3 text-sm font-medium text-brand-ink"
                onClick={() => {
                  setQuestions(String(TYPE_DEFAULTS[offer].questions));
                  setMinutes(String(TYPE_DEFAULTS[offer].minutes));
                  setOffer(null);
                }}
              >
                Use them
              </button>
              <button type="button" className="h-8 rounded-md border border-border-strong px-3 text-sm" onClick={() => setOffer(null)}>
                Keep mine
              </button>
            </div>
          </div>
        ) : null}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Questions per student">
            <Input name="question_count" type="number" min={1} max={200} value={questions} onChange={(e) => setQuestions(e.target.value)} />
          </Field>
          <Field label="Minutes">
            <Input name="duration_minutes" type="number" min={1} max={600} value={minutes} onChange={(e) => setMinutes(e.target.value)} />
          </Field>
        </div>

        <fieldset className="space-y-2 rounded-md border border-border p-3">
          <legend className="px-1 text-[13px] font-medium">Marks</legend>
          <input type="hidden" name="marks_mode" value={marksMode} />
          <label className="flex items-center gap-2 text-sm">
            <input type="radio" checked={marksMode === "per_question"} onChange={() => setMarksMode("per_question")} className="size-4 accent-[var(--brand)]" />
            Each question is worth
            <Input
              name="marks_per_question"
              inputMode="decimal"
              value={perQ}
              onChange={(e) => setPerQ(e.target.value)}
              onFocus={() => setMarksMode("per_question")}
              aria-label="Marks per question"
              className="h-8 w-16"
            />
            marks
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="radio" checked={marksMode === "total"} onChange={() => setMarksMode("total")} className="size-4 accent-[var(--brand)]" />
            The whole test is out of
            <Input
              name="total_marks"
              inputMode="decimal"
              value={total}
              placeholder="20"
              onChange={(e) => setTotal(e.target.value)}
              onFocus={() => setMarksMode("total")}
              aria-label="Test is out of"
              className="h-8 w-16"
            />
          </label>
          <p className="text-xs text-muted">
            Scores are out of <strong className="text-text">{summary.outOf}</strong>
            {summary.mode === "total" ? ` (each question ${summary.perQuestion} ${summary.perQuestion === 1 ? "mark" : "marks"})` : ""}, rounded to one
            decimal place. Reports also show the percentage.
          </p>
        </fieldset>

        <div className="space-y-3 rounded-md bg-surface-2 p-3">
          <Checkbox name="shuffle_questions" label="Shuffle question order" defaultChecked={v.settings.shuffle_questions} />
          <Checkbox name="shuffle_options" label="Shuffle options (A–D)" defaultChecked={v.settings.shuffle_options} />
          <Checkbox
            name="require_all_answered"
            label="Must answer every question before submitting"
            hint="When time runs out the test submits anyway."
            defaultChecked={v.settings.require_all_answered}
          />
          <Checkbox name="allow_flag" label="Allow flagging questions for review" defaultChecked={v.settings.allow_flag} />
          <Checkbox name="allow_back" label="Allow going back to earlier questions" defaultChecked={v.settings.allow_back} />
        </div>
        <Field label="After submitting, students see">
          <Select name="show_result" defaultValue={v.settings.show_result}>
            <option value="none">Nothing: a congratulations message only</option>
            <option value="score">Their score</option>
            <option value="full">Score and corrections</option>
          </Select>
        </Field>
        <Field label="Pass mark (%)">
          <Input name="pass_mark" type="number" min={0} max={100} defaultValue={v.settings.pass_mark} className="w-24" />
        </Field>
        <Field label="Instructions for students" hint="Shown on the start screen.">
          <Textarea name="instructions" rows={3} defaultValue={v.settings.instructions} placeholder="Answer all questions." />
        </Field>
      </fieldset>
    </form>
  );
}

function SaveNote({ state }: { state: SaveState }) {
  if (state.kind === "idle") return null;
  const text = state.kind === "saving" ? "Saving…" : state.kind === "saved" ? `Saved ${state.at}` : state.text;
  return <span className={cn("font-medium", state.kind === "error" || state.kind === "held" ? "text-danger" : "text-muted")}>{text}</span>;
}
