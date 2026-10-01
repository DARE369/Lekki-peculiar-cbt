"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Braces, ClipboardPaste, FileSpreadsheet, FileText, Keyboard, Sheet, type LucideIcon } from "lucide-react";
import { Alert, Button, Card, CardHeader, Field, Input, Select, Textarea, cn } from "@/components/ui";
import { OPTION_KEYS, parseAiken, parseCsv, parseJson, type ParseResult, type ParsedQuestion } from "@/lib/import/questions";
import type { Subject, Year } from "@/lib/types";
import { commitImport } from "../../actions";

type Format = "word" | "excel" | "paste" | "csv" | "json";

const FORMATS: { id: Format; label: string; icon: LucideIcon; accept?: string; template?: string; how: string[] }[] = [
  {
    id: "word",
    label: "Word document",
    icon: FileText,
    accept: ".docx",
    template: "/api/templates/questions.docx",
    how: [
      "Type the question, then each option on its own line: A. B. C. D. (Word's automatic lettering works too).",
      "Under the options, add a line ANSWER: with the correct letter, e.g. ANSWER: B",
      "Leave an empty line between questions. Save as .docx.",
    ],
  },
  {
    id: "excel",
    label: "Excel",
    icon: FileSpreadsheet,
    accept: ".xlsx",
    template: "/api/templates/questions.xlsx",
    how: ["One question per row: Question, Option A–D (E optional), Answer (the letter), and optional Topic.", "Keep the heading row from the template."],
  },
  {
    id: "paste",
    label: "Copy and paste",
    icon: ClipboardPaste,
    how: ["Copy your questions from Word, WhatsApp or anywhere and paste them below, written like the example.", "Each question: the question, then A. B. C. D. options, then ANSWER: and the letter."],
  },
  {
    id: "csv",
    label: "CSV",
    icon: Sheet,
    accept: ".csv",
    template: "/api/templates/questions.csv",
    how: ["Same columns as the Excel template, saved as CSV (Excel: File → Save As → CSV)."],
  },
  {
    id: "json",
    label: "JSON (advanced)",
    icon: Braces,
    accept: ".json",
    template: "/api/templates/questions.json",
    how: ["For files exported from another system. See the template for the layout."],
  },
];

export function ImportWizard({
  subjects,
  years,
  defaultSubject,
  defaultYear,
  assessmentId,
}: {
  subjects: Subject[];
  years: Year[];
  defaultSubject?: string;
  defaultYear?: string;
  assessmentId?: string;
}) {
  const router = useRouter();
  const [subjectId, setSubjectId] = useState(defaultSubject ?? subjects[0]?.id ?? "");
  const [yearId, setYearId] = useState(defaultYear ?? "");
  const [format, setFormat] = useState<Format>("word");
  const [paste, setPaste] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [questions, setQuestions] = useState<ParsedQuestion[] | null>(null);
  const [issues, setIssues] = useState<ParseResult["issues"]>([]);
  const [editing, setEditing] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const subject = subjects.find((s) => s.id === subjectId);
  const sectionYears = years.filter((y) => y.section_id === subject?.section_id);
  const current = FORMATS.find((f) => f.id === format)!;

  function show(result: ParseResult, name: string) {
    setFileName(name);
    setQuestions(result.questions);
    setIssues(result.issues);
    setEditing(null);
  }

  async function handleFile(file: File) {
    setMessage(null);
    setBusy(true);
    try {
      const ext = file.name.toLowerCase().split(".").pop();
      if (ext === "xlsx") {
        const fd = new FormData();
        fd.append("file", file);
        const res = await fetch("/api/import/parse", { method: "POST", body: fd });
        const json = await res.json();
        show(res.ok ? json : { questions: [], issues: [{ source: "file", message: json.error ?? "Upload failed" }] }, file.name);
      } else if (ext === "docx") {
        const { docxToText } = await import("@/lib/import/docx");
        show(parseAiken(await docxToText(await file.arrayBuffer())), file.name);
      } else if (ext === "doc") {
        show({ questions: [], issues: [{ source: "file", message: "This is an old Word file (.doc). Open it in Word and use File → Save As → Word Document (.docx)." }] }, file.name);
      } else {
        const content = await file.text();
        show(ext === "csv" ? parseCsv(content) : ext === "json" || /^\s*[[{]/.test(content) ? parseJson(content) : parseAiken(content), file.name);
      }
    } catch {
      show({ questions: [], issues: [{ source: "file", message: "Could not read this file. Check it is the right type and try again." }] }, file.name);
    } finally {
      setBusy(false);
    }
  }

  function handlePaste() {
    setMessage(null);
    show(/^\s*[[{]/.test(paste) ? parseJson(paste) : parseAiken(paste), "pasted text");
  }

  function update(i: number, q: ParsedQuestion) {
    setQuestions((qs) => qs!.map((x, j) => (j === i ? q : x)));
  }
  function remove(i: number) {
    setQuestions((qs) => qs!.filter((_, j) => j !== i));
    setEditing(null);
  }

  const problems = (questions ?? []).map(problemWith);
  const firstProblem = problems.findIndex(Boolean);

  function save() {
    if (!questions?.length) return;
    if (firstProblem >= 0) {
      setEditing(firstProblem);
      return;
    }
    startTransition(async () => {
      const res = await commitImport({ subjectId, yearId: yearId || null, assessmentId: assessmentId ?? null, questions });
      if (res && res.ok) {
        setMessage({ tone: "success", text: res.message ?? "Imported." });
        setQuestions(null);
        setIssues([]);
        setPaste("");
        setFileName(null);
        if (assessmentId) router.push(`/teach/assessments/${assessmentId}`);
        else router.refresh();
      } else {
        setMessage({ tone: "danger", text: res && !res.ok ? res.error : "Import failed." });
      }
    });
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader title="1. Where do these questions belong?" />
        <div className="grid gap-4 p-5 sm:grid-cols-2">
          <Field label="Subject">
            <Select value={subjectId} onChange={(e) => setSubjectId(e.target.value)} disabled={Boolean(assessmentId)}>
              {subjects.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Year group" hint="So the questions show up for the right classes.">
            <Select value={yearId} onChange={(e) => setYearId(e.target.value)}>
              <option value="">Any year</option>
              {sectionYears.map((y) => (
                <option key={y.id} value={y.id}>
                  {y.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </Card>

      <Card>
        <CardHeader title="2. How are your questions written?" description="Pick one. You'll check every question before anything is saved." />
        <div className="grid grid-cols-2 gap-2 px-5 sm:grid-cols-3 lg:grid-cols-6">
          {FORMATS.map((f) => (
            <button
              key={f.id}
              type="button"
              aria-pressed={format === f.id}
              onClick={() => setFormat(f.id)}
              className={cn(
                "flex flex-col items-center gap-1.5 rounded-xl border-2 px-2 py-3 text-center text-sm font-semibold transition",
                format === f.id ? "border-brand bg-brand-soft text-brand" : "border-border hover:border-brand/50",
              )}
            >
              <f.icon className="size-6" aria-hidden />
              {f.label}
            </button>
          ))}
          <Link
            href={`/teach/questions/new?subject=${subjectId}${assessmentId ? `&assessment=${assessmentId}` : ""}`}
            className="flex flex-col items-center gap-1.5 rounded-xl border-2 border-dashed border-border px-2 py-3 text-center text-sm font-semibold hover:border-brand/50"
          >
            <Keyboard className="size-6" aria-hidden />
            Type one at a time
          </Link>
        </div>
        <div className="grid gap-6 p-5 lg:grid-cols-2">
          <div className="rounded-xl bg-surface-2 p-4 text-sm">
            <p className="font-semibold">How to write them</p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-muted">
              {current.how.map((h) => (
                <li key={h}>{h}</li>
              ))}
            </ul>
            <pre className="mt-3 overflow-x-auto rounded-lg border border-border bg-surface p-3 font-mono text-xs leading-relaxed">
              {"What is 2 + 2?\nA. 3\nB. 4\nC. 5\nD. 6\nANSWER: B"}
            </pre>
            {current.template ? (
              <a href={current.template} className="mt-3 inline-block font-semibold text-brand hover:underline">
                Download the {current.label} template
              </a>
            ) : null}
          </div>
          {format === "paste" ? (
            <div>
              <Textarea
                rows={10}
                value={paste}
                onChange={(e) => setPaste(e.target.value)}
                placeholder={"What is 2 + 2?\nA. 3\nB. 4\nC. 5\nANSWER: B"}
                className="font-mono text-xs"
                aria-label="Paste your questions"
              />
              <Button variant="primary" className="mt-2" onClick={handlePaste} disabled={!paste.trim()}>
                Check pasted questions
              </Button>
            </div>
          ) : (
            <label className="flex min-h-48 cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-border text-center text-sm text-muted hover:border-brand">
              <input
                type="file"
                accept={current.accept}
                className="sr-only"
                aria-label={`Choose a ${current.label} file`}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void handleFile(f);
                  e.target.value = "";
                }}
              />
              <current.icon className="mb-2 size-8 text-brand" aria-hidden />
              <span className="text-base font-semibold text-text">{busy ? "Reading…" : `Choose your ${current.label} file`}</span>
              <span>{current.accept}</span>
            </label>
          )}
        </div>
      </Card>

      {message ? <Alert tone={message.tone}>{message.text}</Alert> : null}

      {questions ? (
        <Card>
          <CardHeader
            title={`3. Check and edit — ${fileName}`}
            description={`${questions.length} ready · ${issues.length} need fixing`}
            actions={
              <Button onClick={save} disabled={pending || questions.length === 0 || !subjectId}>
                {pending ? "Importing…" : `Import ${questions.length} question${questions.length === 1 ? "" : "s"}`}
              </Button>
            }
          />
          {issues.length ? (
            <div className="border-b border-border p-5">
              <Alert tone="warning" title="These couldn't be read and were left out — fix them in your file and upload again:">
                <ul className="mt-1 list-disc space-y-0.5 pl-5">
                  {issues.slice(0, 50).map((i, idx) => (
                    <li key={idx}>
                      <strong>{i.source}:</strong> {i.message}
                    </li>
                  ))}
                </ul>
                {issues.length > 50 ? <p className="mt-1">…and {issues.length - 50} more.</p> : null}
              </Alert>
            </div>
          ) : null}
          {firstProblem >= 0 ? (
            <div className="px-5 pt-4">
              <Alert tone="danger">Question {firstProblem + 1} needs fixing before you can import: {problems[firstProblem]}</Alert>
            </div>
          ) : null}
          <ol className="divide-y divide-border">
            {questions.map((q, i) =>
              editing === i ? (
                <li key={i} className="bg-surface-2/50 p-5">
                  <QuestionEditor q={q} onDone={(next) => (update(i, next), setEditing(null))} onCancel={() => setEditing(null)} />
                </li>
              ) : (
                <li key={i} className={cn("flex gap-4 px-5 py-4", problems[i] && "bg-danger-soft/40")}>
                  <span className="w-6 shrink-0 text-sm text-muted tabular-nums">{i + 1}.</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm whitespace-pre-wrap">{q.body}</p>
                    <div className="mt-1 grid gap-x-4 text-xs text-muted sm:grid-cols-2">
                      {q.options.map((o) => (
                        <span key={o.key} className={o.key === q.answer ? "font-semibold text-success" : ""}>
                          {o.key}. {o.text}
                          {o.key === q.answer ? " ✓" : ""}
                        </span>
                      ))}
                    </div>
                    {q.topic ? <p className="mt-1 text-xs text-muted">Topic: {q.topic}</p> : null}
                    {problems[i] ? <p className="mt-1 text-xs font-semibold text-danger">{problems[i]}</p> : null}
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1.5">
                    <button type="button" onClick={() => setEditing(i)} className="text-xs font-semibold text-brand hover:underline" aria-label={`Edit question ${i + 1}`}>
                      Edit
                    </button>
                    <button type="button" onClick={() => remove(i)} className="text-xs text-muted hover:text-danger" aria-label={`Remove question ${i + 1}`}>
                      Remove
                    </button>
                  </div>
                </li>
              ),
            )}
          </ol>
        </Card>
      ) : null}
    </div>
  );
}

function problemWith(q: ParsedQuestion): string | null {
  if (!q.body.trim()) return "The question text is empty.";
  if (q.options.length < 2) return "Add at least two options.";
  if (q.options.some((o) => !o.text.trim())) return "One of the options is empty.";
  if (!q.options.some((o) => o.key === q.answer)) return "Choose the correct answer.";
  return null;
}

/** Inline editor for one question in the preview, before anything is saved. */
function QuestionEditor({ q, onDone, onCancel }: { q: ParsedQuestion; onDone: (q: ParsedQuestion) => void; onCancel: () => void }) {
  const [body, setBody] = useState(q.body);
  const [options, setOptions] = useState(q.options.map((o) => o.text));
  const [answer, setAnswer] = useState(q.answer);
  const [topic, setTopic] = useState(q.topic ?? "");
  const keys = OPTION_KEYS.slice(0, options.length);
  return (
    <div className="space-y-3">
      <Field label="Question">
        <Textarea rows={3} value={body} onChange={(e) => setBody(e.target.value)} />
      </Field>
      <div className="grid gap-2 sm:grid-cols-2">
        {options.map((text, k) => (
          <Field key={k} label={`Option ${keys[k]}`}>
            <div className="flex gap-2">
              <Input value={text} onChange={(e) => setOptions(options.map((t, j) => (j === k ? e.target.value : t)))} />
              {options.length > 2 ? (
                <button
                  type="button"
                  className="text-xs text-muted hover:text-danger"
                  onClick={() => {
                    const removedKey = keys[k];
                    setOptions(options.filter((_, j) => j !== k));
                    if (answer === removedKey) setAnswer("");
                    else if (answer > removedKey) setAnswer(String.fromCharCode(answer.charCodeAt(0) - 1));
                  }}
                  aria-label={`Remove option ${keys[k]}`}
                >
                  ✕
                </button>
              ) : null}
            </div>
          </Field>
        ))}
      </div>
      {options.length < OPTION_KEYS.length ? (
        <button type="button" className="text-sm font-semibold text-brand hover:underline" onClick={() => setOptions([...options, ""])}>
          + Add option {OPTION_KEYS[options.length]}
        </button>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Correct answer">
          <Select value={answer} onChange={(e) => setAnswer(e.target.value)}>
            <option value="" disabled>
              Choose…
            </option>
            {keys.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Topic (optional)">
          <Input value={topic} onChange={(e) => setTopic(e.target.value)} />
        </Field>
      </div>
      <div className="flex gap-2">
        <Button
          size="sm"
          onClick={() =>
            onDone({ ...q, body: body.trim(), options: options.map((t, k) => ({ key: keys[k], text: t.trim() })), answer, topic: topic.trim() || null })
          }
        >
          Done
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
