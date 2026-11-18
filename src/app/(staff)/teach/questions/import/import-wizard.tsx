"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Braces, Check, ClipboardCheck, ClipboardPaste, Copy, FileSpreadsheet, FileText, Keyboard, Sheet, Sparkles, type LucideIcon } from "lucide-react";
import { Alert, Badge, Button, Card, CardHeader, Field, Input, LinkButton, Select, Textarea, cn } from "@/components/ui";
import { OPTION_KEYS, looksLikeJson, parseCsv, parseText, questionFingerprint, type IssueCode, type ParseResult, type ParsedQuestion } from "@/lib/import/questions";
import type { Subject, Year } from "@/lib/types";
import { checkImportDuplicates, commitImport, type BankMatch, type ImportReceipt } from "../../import-actions";

type Draft = ParsedQuestion & { forceNew?: boolean };
type SourceFormat = "paste" | "word" | "excel" | "csv" | "json" | "text";

type Format = "word" | "excel" | "paste" | "csv" | "json";

const FORMATS: { id: Format; label: string; icon: LucideIcon; accept?: string; template?: string; how: string[] }[] = [
  {
    id: "paste",
    label: "Copy and paste",
    icon: ClipboardPaste,
    how: [
      "Paste JSON (for example from ChatGPT) or plain text copied from Word, WhatsApp or anywhere.",
      "We check it as you paste. Nothing is saved until you press Import.",
    ],
  },
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
      "Quicker: open the Word file, press Ctrl+A then Ctrl+C, and paste it under Copy and paste.",
    ],
  },
  {
    id: "json",
    label: "JSON file",
    icon: Braces,
    accept: ".json,.txt",
    template: "/api/templates/questions.json",
    how: ["A .json (or .txt) file with a list of questions. See the template for the layout.", "Quicker: open the file, copy everything, and paste it under Copy and paste."],
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
    id: "csv",
    label: "CSV",
    icon: Sheet,
    accept: ".csv",
    template: "/api/templates/questions.csv",
    how: ["Same columns as the Excel template, saved as CSV (Excel: File → Save As → CSV)."],
  },
];

const JSON_EXAMPLE = `[
  {
    "question": "What is the powerhouse of the cell?",
    "options": ["Nucleus", "Mitochondria", "Ribosome", "Golgi body"],
    "answer": "B",
    "topic": "Cells",
    "difficulty": "easy",
    "explanation": "Mitochondria produce energy (ATP)."
  }
]`;
const TEXT_EXAMPLE = "What is 2 + 2?\nA. 3\nB. 4\nC. 5\nD. 6\nANSWER: B";

/** The instructions teachers paste into ChatGPT (or any AI) so its answer can be pasted straight back here. */
function aiPrompt(subject: string, year: string) {
  return `Write 20 multiple-choice questions for ${subject}${year ? ` (${year})` : ""} for a Nigerian school.
Reply with ONLY a JSON list. No explanations, no markdown, no extra words. Use exactly this layout:

${JSON_EXAMPLE}

Rules: give 4 options each. "answer" is the letter of the correct option (A, B, C or D). "difficulty" is easy, medium or hard. "topic" and "explanation" are optional.`;
}

type IssueGroup = { key: string; label: string; fix: string; items: ParseResult["issues"] };

const ISSUE_HELP: Record<IssueCode, { label: string; fix: string }> = {
  EMPTY_QUESTION: { label: "Missing question text", fix: "Write the question before the A., B., C. option lines (or fill the Question column)." },
  NO_ANSWER: { label: "Missing answer", fix: 'Add a line like "ANSWER: B" under the options, or fill the Answer column with the letter.' },
  ANSWER_NOT_AN_OPTION: { label: "Answer doesn't match an option", fix: "The answer must be one of the option letters. Check for typos, or a letter with no option (e.g. answer E with only A–D)." },
  OPTION_GAP: { label: "Gap in the options", fix: "Options must run A, B, C… with no letter skipped." },
  TOO_FEW_OPTIONS: { label: "Too few options", fix: 'Every question needs at least A and B, each on its own line: "A. First option".' },
  TOO_MANY_OPTIONS: { label: "Too many options", fix: "The most is six options (A–F)." },
  SUSPECTED_MERGE: { label: "Two questions ran together", fix: "Add the ANSWER line to the first question and leave an empty line before the next one." },
  TOO_LONG: { label: "Too long", fix: "Shorten the text. Questions can be up to 5,000 characters and options up to 1,000." },
  FILE_UNREADABLE: { label: "Couldn't read the file", fix: "Check it's the right kind of file (.docx for Word, .xlsx for Excel), or copy the questions and use Copy and paste." },
  NO_QUESTION_COLUMN: { label: "Column headings not found", fix: 'The first row needs headings like "Question", "Option A", "Option B", "Answer". Download the template to see them.' },
  OTHER: { label: "Other problems", fix: "Fix the problem shown next to each one, then upload again." },
};

function groupIssues(issues: ParseResult["issues"]): IssueGroup[] {
  const groups = new Map<string, IssueGroup>();
  for (const i of issues) {
    const code = i.code ?? "OTHER";
    if (!groups.has(code)) groups.set(code, { key: code, ...ISSUE_HELP[code], items: [] });
    groups.get(code)!.items.push(i);
  }
  return [...groups.values()];
}

function formatOf(name: string): SourceFormat {
  const ext = name.toLowerCase().split(".").pop();
  if (name === "pasted text") return "paste";
  if (ext === "docx") return "word";
  if (ext === "xlsx") return "excel";
  if (ext === "csv") return "csv";
  if (ext === "json") return "json";
  return "text";
}

function shortDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export function ImportWizard({
  subjects,
  years,
  defaultSubject,
  defaultYear,
  assessmentId,
  assessmentTitle,
}: {
  subjects: Subject[];
  years: Year[];
  defaultSubject?: string;
  defaultYear?: string;
  assessmentId?: string;
  assessmentTitle?: string;
}) {
  const router = useRouter();
  const [subjectId, setSubjectId] = useState(defaultSubject ?? subjects[0]?.id ?? "");
  const [yearId, setYearId] = useState(defaultYear ?? "");
  const [label, setLabel] = useState(assessmentTitle ?? "");
  const [removed, setRemoved] = useState(0);
  const [matches, setMatches] = useState<Map<string, BankMatch>>(new Map());
  const [checking, setChecking] = useState(false);
  const [receipt, setReceipt] = useState<ImportReceipt | null>(null);
  const [format, setFormat] = useState<Format>("paste");
  const [paste, setPaste] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [questions, setQuestions] = useState<Draft[] | null>(null);
  const [issues, setIssues] = useState<ParseResult["issues"]>([]);
  const [notes, setNotes] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
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
    setNotes(result.notes ?? []);
    setEditing(null);
    setRemoved(0);
    setReceipt(null);
  }

  // Which questions are already in this teacher's bank? Checked before anything is saved, so the
  // preview can say so on each one instead of quietly leaving them out.
  const prints = useMemo(() => (questions ?? []).map((q) => questionFingerprint(q)), [questions]);
  const printKey = prints.join("\n");
  useEffect(() => {
    if (!questions?.length || !subjectId) return;
    let cancelled = false;
    const list = questions.map((q) => ({ body: q.body, options: q.options.map((o) => ({ text: o.text })) }));
    // Deferred a tick so typing/pasting stays smooth; results are keyed by fingerprint, so stale ones are harmless.
    const t = setTimeout(() => {
      setChecking(true);
      checkImportDuplicates({ subjectId, yearId: yearId || null, assessmentId: assessmentId ?? null, questions: list })
        .then((found) => {
          if (!cancelled) setMatches(new Map(found.map((m) => [prints[m.index], m])));
        })
        .catch(() => {
          if (!cancelled) setMatches(new Map());
        })
        .finally(() => {
          if (!cancelled) setChecking(false);
        });
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- printKey stands for the questions' content
  }, [printKey, subjectId, yearId, assessmentId]);

  // The same question twice in this file: the second copy is left out unless the teacher keeps it.
  const repeatOf = useMemo(() => {
    const first = new Map<string, number>();
    return prints.map((p, i) => {
      if (first.has(p)) return first.get(p)!;
      first.set(p, i);
      return null;
    });
  }, [prints]);

  function scrollToPreview() {
    setTimeout(() => document.getElementById("import-preview")?.scrollIntoView({ behavior: "smooth", block: "start" }), 150);
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
        show(res.ok ? json : { questions: [], issues: [{ source: "file", code: "FILE_UNREADABLE", message: json.error ?? "Upload failed" }] }, file.name);
      } else if (ext === "docx") {
        const { docxToText } = await import("@/lib/import/docx");
        show(parseText(await docxToText(await file.arrayBuffer())), file.name);
      } else if (ext === "doc") {
        show({ questions: [], issues: [{ source: "file", code: "FILE_UNREADABLE", message: "This is an old Word file (.doc). Open it in Word and use File → Save As → Word Document (.docx)." }] }, file.name);
      } else {
        const content = await file.text();
        show(ext === "csv" ? parseCsv(content) : parseText(content), file.name);
      }
      scrollToPreview();
    } catch {
      show({ questions: [], issues: [{ source: "file", code: "FILE_UNREADABLE", message: "Could not read this file. Check it is the right type and try again." }] }, file.name);
    } finally {
      setBusy(false);
    }
  }

  /** Checks the pasted text a moment after the last keystroke or paste, so there is no button to forget. */
  function onPasteChange(value: string) {
    setPaste(value);
    setMessage(null);
    if (timer.current) clearTimeout(timer.current);
    if (!value.trim()) {
      setQuestions(null);
      setIssues([]);
      setNotes([]);
      return;
    }
    timer.current = setTimeout(() => show(parseText(value), "pasted text"), 350);
  }

  async function copyPrompt() {
    const text = aiPrompt(subject?.name ?? "my subject", sectionYears.find((y) => y.id === yearId)?.name ?? "");
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
    } catch {
      setMessage({ tone: "danger", text: "Your browser would not copy that. Select the text in the example and copy it yourself." });
    }
  }

  async function pasteFromClipboard() {
    try {
      onPasteChange(await navigator.clipboard.readText());
    } catch {
      setMessage({ tone: "danger", text: "Your browser needs permission to paste for you. Tap inside the box, then paste (hold your finger down, or Ctrl+V)." });
    }
  }

  function update(i: number, q: Draft) {
    setQuestions((qs) => qs!.map((x, j) => (j === i ? q : x)));
  }
  function remove(i: number) {
    setQuestions((qs) => qs!.filter((_, j) => j !== i));
    setRemoved((n) => n + 1);
    setEditing(null);
  }
  function toggleForceNew(i: number) {
    setQuestions((qs) => qs!.map((x, j) => (j === i ? { ...x, forceNew: !x.forceNew } : x)));
  }

  const problems = (questions ?? []).map(problemWith);
  const firstProblem = problems.findIndex(Boolean);

  const issueGroups = groupIssues(issues);

  const reused = (questions ?? []).filter((q, i) => !q.forceNew && (matches.has(prints[i]) || repeatOf[i] !== null)).length;
  const newCount = (questions?.length ?? 0) - reused;

  function save() {
    if (!questions?.length && issues.length === 0) return;
    if (firstProblem >= 0) {
      setEditing(firstProblem);
      return;
    }
    setMessage(null);
    startTransition(async () => {
      const res = await commitImport({
        subjectId,
        yearId: yearId || null,
        assessmentId: assessmentId ?? null,
        label: label.trim(),
        fileName: fileName === "pasted text" ? null : fileName,
        format: fileName ? formatOf(fileName) : null,
        questions: questions ?? [],
        removedCount: removed,
        unreadable: issues.map((i) => ({ code: i.code, source: i.source.slice(0, 200), message: i.message.slice(0, 600), excerpt: i.excerpt })),
      });
      if (res.ok) {
        setReceipt(res.receipt);
        setQuestions(null);
        setNotes([]);
        setPaste("");
        router.refresh();
        setTimeout(() => document.getElementById("import-receipt")?.scrollIntoView({ behavior: "smooth", block: "start" }), 100);
      } else {
        setMessage({ tone: "danger", text: res.ref ? `${res.error} (Reference ${res.ref})` : res.error });
      }
    });
  }

  if (receipt) {
    return (
      <ImportReceiptCard
        receipt={receipt}
        issues={issues}
        assessmentId={assessmentId}
        bankHref={`/teach/questions?subject=${subjectId}${yearId ? `&year=${yearId}` : ""}&upload=${receipt.uploadId}`}
        onAgain={() => {
          setReceipt(null);
          setIssues([]);
          setFileName(null);
          setLabel("");
        }}
      />
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader title="1. Where do these questions belong?" />
        <div className="grid gap-4 p-5 sm:grid-cols-3">
          <Field label="Subject">
            <Select
              value={subjectId}
              onChange={(e) => {
                setSubjectId(e.target.value);
                // a year group from another section would hide the questions from every bank view
                const next = subjects.find((x) => x.id === e.target.value);
                if (yearId && years.find((y) => y.id === yearId)?.section_id !== next?.section_id) setYearId("");
              }}
              disabled={Boolean(assessmentId)}
            >
              {subjects.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Year group" hint="So the questions show up for the right classes.">
            <Select value={yearId} onChange={(e) => setYearId(e.target.value)} disabled={Boolean(assessmentId)}>
              <option value="">Any year</option>
              {sectionYears.map((y) => (
                <option key={y.id} value={y.id}>
                  {y.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Name this upload" hint="You'll find it by this name in the bank and when building tests.">
            <Input
              value={label}
              maxLength={80}
              onChange={(e) => setLabel(e.target.value)}
              placeholder={`e.g. 1st CA — ${subject?.name ?? "Maths"}`}
            />
          </Field>
        </div>
      </Card>

      <Card>
        <CardHeader title="2. How are your questions written?" description="Pick one. You'll check every question before anything is saved." />
        <div className="grid grid-cols-2 gap-2 px-4 sm:grid-cols-3 sm:px-5 lg:grid-cols-6">
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
              {format === "json" || (format === "paste" && looksLikeJson(paste)) ? JSON_EXAMPLE : TEXT_EXAMPLE}
            </pre>
            {current.template ? (
              <a href={current.template} className="mt-3 inline-block font-semibold text-brand hover:underline">
                Download the {current.label} template
              </a>
            ) : null}
          </div>
          {format === "paste" ? (
            <div className="max-lg:order-first">
              <Textarea
                rows={10}
                value={paste}
                onChange={(e) => onPasteChange(e.target.value)}
                placeholder="Paste your questions here — JSON or plain text"
                className="font-mono text-xs"
                aria-label="Paste your questions"
                spellCheck={false}
                autoCapitalize="off"
                autoCorrect="off"
              />
              <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm" aria-live="polite">
                {paste.trim() ? (
                  <>
                    <span className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-2.5 py-0.5 text-xs font-semibold">
                      {looksLikeJson(paste) ? "Reading as JSON" : "Reading as plain text"}
                    </span>
                    {questions && fileName === "pasted text" ? (
                      <span className={issues.length ? "text-warning" : "text-success"}>
                        <strong>{questions.length}</strong> question{questions.length === 1 ? "" : "s"} found
                        {issues.length ? ` · ${issues.length} need fixing` : ""}
                      </span>
                    ) : null}
                  </>
                ) : (
                  <span className="text-muted">Waiting for your questions…</span>
                )}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button variant="secondary" size="sm" onClick={pasteFromClipboard}>
                  <ClipboardCheck aria-hidden /> Paste from clipboard
                </Button>
                <Button variant="secondary" size="sm" onClick={() => onPasteChange(JSON_EXAMPLE)}>
                  <Sparkles aria-hidden /> Try an example
                </Button>
                {paste ? (
                  <Button variant="ghost" size="sm" onClick={() => onPasteChange("")}>
                    Clear
                  </Button>
                ) : null}
              </div>
              <div className="mt-4 rounded-xl border border-border p-3 text-sm">
                <p className="font-semibold">Using ChatGPT or another AI?</p>
                <p className="mt-1 text-muted">Copy these instructions, paste them into the AI, then paste its answer above.</p>
                <Button variant="secondary" size="sm" className="mt-2" onClick={copyPrompt}>
                  {copied ? <Check aria-hidden /> : <Copy aria-hidden />} {copied ? "Copied — now paste it into the AI" : "Copy instructions for the AI"}
                </Button>
              </div>
            </div>
          ) : (
            <label className="flex min-h-48 cursor-pointer max-lg:order-first flex-col items-center justify-center rounded-xl border-2 border-dashed border-border text-center text-sm text-muted hover:border-brand">
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
        <Card id="import-preview" className="scroll-mt-20">
          <CardHeader
            title={`3. Check and edit — ${fileName}`}
            description={
              <>
                {questions.length + issues.length + removed} found
                {newCount ? ` · ${newCount} new` : ""}
                {reused ? ` · ${reused} already in your bank${assessmentId ? " (will be added to this test)" : ""}` : ""}
                {issues.length ? ` · ${issues.length} couldn't be read` : ""}
                {removed ? ` · ${removed} removed by you` : ""}
                {checking ? " · checking your bank…" : ""}
              </>
            }
            actions={
              <Button onClick={save} disabled={pending || checking || questions.length === 0 || !subjectId}>
                {pending ? "Saving…" : `Save ${questions.length} question${questions.length === 1 ? "" : "s"}`}
              </Button>
            }
          />
          {notes.length ? (
            <div className="border-b border-border p-5">
              <Alert tone="info" title="We tidied up your text:">
                <ul className="mt-1 list-disc space-y-0.5 pl-5">
                  {notes.map((n) => (
                    <li key={n}>{n}</li>
                  ))}
                </ul>
              </Alert>
            </div>
          ) : null}
          {issueGroups.length ? (
            <div className="space-y-3 border-b border-border p-5">
              <p className="text-sm font-semibold text-warning">
                {issues.length} question{issues.length === 1 ? "" : "s"} couldn&apos;t be read. They won&apos;t be saved, and this upload&apos;s record will list them so you can fix them in your file:
              </p>
              {issueGroups.map((g) => (
                <Alert key={g.key} tone="warning" title={`${g.label} (${g.items.length} question${g.items.length === 1 ? "" : "s"})`}>
                  <p className="mt-1 text-xs">
                    <strong>How to fix:</strong> {g.fix}
                  </p>
                  <ul className="mt-2 list-disc space-y-0.5 pl-4 text-xs">
                    {g.items.slice(0, 8).map((item, idx) => (
                      <li key={idx}>
                        <strong>{item.source}</strong>
                        {item.excerpt ? <> (&ldquo;{item.excerpt}&rdquo;)</> : null}: {item.message}
                      </li>
                    ))}
                    {g.items.length > 8 ? <li>…and {g.items.length - 8} more like this.</li> : null}
                  </ul>
                </Alert>
              ))}
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
                    {q.warnings?.map((w) => (
                      <p key={w} className="mt-1 text-xs text-warning">
                        {w}
                      </p>
                    ))}
                    <DuplicateNote
                      match={matches.get(prints[i])}
                      repeatOf={repeatOf[i]}
                      forceNew={Boolean(q.forceNew)}
                      inTestFlow={Boolean(assessmentId)}
                      onToggle={() => toggleForceNew(i)}
                    />
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

function DuplicateNote({
  match,
  repeatOf,
  forceNew,
  inTestFlow,
  onToggle,
}: {
  match?: BankMatch;
  repeatOf: number | null;
  forceNew: boolean;
  inTestFlow: boolean;
  onToggle: () => void;
}) {
  if (!match && repeatOf === null) return null;
  const where = match ? (match.uploadLabel ? `“${match.uploadLabel}”` : "your bank") : null;
  const what = match
    ? `Already in ${where}, added ${shortDate(match.createdAt)}. ${
        forceNew ? "A second copy will be saved." : match.inTest ? "It's already in this test." : inTestFlow ? "The existing one will be added to this test." : "It won't be saved again."
      }`
    : `Same as question ${repeatOf! + 1} in this file. ${forceNew ? "Both will be saved." : "Only one copy will be saved."}`;
  return (
    <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
      <Badge tone={forceNew ? "neutral" : "info"}>{forceNew ? "Saving a copy" : "Duplicate"}</Badge>
      <span className="text-muted">{what}</span>
      <button type="button" onClick={onToggle} className="font-semibold text-brand hover:underline">
        {forceNew ? "Don't save a copy" : "Save a copy anyway"}
      </button>
    </p>
  );
}

function ImportReceiptCard({
  receipt: r,
  issues,
  assessmentId,
  bankHref,
  onAgain,
}: {
  receipt: ImportReceipt;
  issues: ParseResult["issues"];
  assessmentId?: string;
  bankHref: string;
  onAgain: () => void;
}) {
  const rows: [string, number, string][] = [
    ["Saved as new questions", r.imported, "text-success"],
    [assessmentId ? "Already in your bank, added to this test" : "", r.linked, ""],
    ["Already in your bank, not saved again", r.alreadyInBank, ""],
    ["Repeated in this file, saved once", r.duplicateInFile, ""],
    ["Removed by you before saving", r.removed, ""],
    ["Couldn't be read", r.unreadable, "text-danger"],
  ];
  return (
    <Card id="import-receipt" className="scroll-mt-20">
      <CardHeader title={`Saved “${r.label}”`} description={`${r.found} question${r.found === 1 ? "" : "s"} in what you uploaded. Here's what happened to each one.`} />
      <dl className="divide-y divide-border">
        {rows
          .filter(([label, n]) => label && n > 0)
          .map(([label, n, cls]) => (
            <div key={label} className="flex items-baseline justify-between gap-4 px-5 py-3 text-sm">
              <dt>{label}</dt>
              <dd className={cn("font-semibold tabular-nums", cls)}>{n}</dd>
            </div>
          ))}
        <div className="flex items-baseline justify-between gap-4 bg-surface-2 px-5 py-3 text-sm font-semibold">
          <dt>Total</dt>
          <dd className="tabular-nums">{r.found}</dd>
        </div>
      </dl>
      {issues.length ? (
        <div className="space-y-2 border-t border-border p-5 text-sm">
          <p className="font-semibold">Fix these in your file, then upload them again:</p>
          <ul className="list-disc space-y-1 pl-5 text-muted">
            {issues.slice(0, 20).map((i, k) => (
              <li key={k}>
                <span className="font-medium text-text">{i.source}</span>
                {i.excerpt ? <> (&ldquo;{i.excerpt}&rdquo;)</> : null}: {i.message}
              </li>
            ))}
            {issues.length > 20 ? <li>…and {issues.length - 20} more. They are all listed on this upload in the question bank.</li> : null}
          </ul>
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2 border-t border-border p-5">
        {assessmentId ? <LinkButton href={`/teach/assessments/${assessmentId}`}>Back to the test</LinkButton> : null}
        <LinkButton href={bankHref} variant={assessmentId ? "secondary" : "primary"}>
          See this upload in the bank
        </LinkButton>
        <Button variant="ghost" onClick={onAgain}>
          Upload more
        </Button>
      </div>
    </Card>
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
