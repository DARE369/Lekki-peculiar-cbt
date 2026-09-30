"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Alert, Badge, Button, Card, CardHeader, Field, Select, Table, Td, Textarea, Th } from "@/components/ui";
import { detectFormat, parseAiken, parseCsv, parseJson, type ParseResult } from "@/lib/import/questions";
import type { Subject, Year } from "@/lib/types";
import { commitImport } from "../../actions";

export function ImportWizard({
  subjects,
  years,
  defaultSubject,
  assessmentId,
}: {
  subjects: Subject[];
  years: Year[];
  defaultSubject?: string;
  assessmentId?: string;
}) {
  const router = useRouter();
  const [subjectId, setSubjectId] = useState(defaultSubject ?? subjects[0]?.id ?? "");
  const [yearId, setYearId] = useState("");
  const [paste, setPaste] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [result, setResult] = useState<ParseResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const subject = subjects.find((s) => s.id === subjectId);
  const sectionYears = years.filter((y) => y.section_id === subject?.section_id);

  async function handleFile(file: File) {
    setMessage(null);
    setFileName(file.name);
    setBusy(true);
    try {
      const format = detectFormat(file.name);
      if (format === "xlsx") {
        const fd = new FormData();
        fd.append("file", file);
        const res = await fetch("/api/import/parse", { method: "POST", body: fd });
        const json = await res.json();
        setResult(res.ok ? json : { questions: [], issues: [{ source: "file", message: json.error ?? "Upload failed" }] });
      } else {
        const content = await file.text();
        const f = detectFormat(file.name, content);
        setResult(f === "csv" ? parseCsv(content) : f === "json" ? parseJson(content) : parseAiken(content));
      }
    } finally {
      setBusy(false);
    }
  }

  function handlePaste() {
    setMessage(null);
    setFileName("pasted text");
    const f = detectFormat("pasted.txt", paste);
    setResult(f === "json" ? parseJson(paste) : parseAiken(paste));
  }

  function save() {
    if (!result?.questions.length) return;
    startTransition(async () => {
      const res = await commitImport({
        subjectId,
        yearId: yearId || null,
        assessmentId: assessmentId ?? null,
        questions: result.questions,
      });
      if (res && res.ok) {
        setMessage({ tone: "success", text: res.message ?? "Imported." });
        setResult(null);
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
          <Field label="Year group (optional)">
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
        <CardHeader
          title="2. Upload a file or paste questions"
          description="Excel (.xlsx), CSV, plain text or JSON. Download a template if you're starting fresh."
          actions={
            <div className="flex flex-wrap gap-2 text-sm">
              <a className="rounded-lg border border-border px-3 py-1.5 hover:bg-surface-2" href="/api/templates/questions.xlsx">
                Excel template
              </a>
              <a className="rounded-lg border border-border px-3 py-1.5 hover:bg-surface-2" href="/api/templates/questions.txt">
                Text template
              </a>
              <a className="rounded-lg border border-border px-3 py-1.5 hover:bg-surface-2" href="/api/templates/questions.csv">
                CSV
              </a>
              <a className="rounded-lg border border-border px-3 py-1.5 hover:bg-surface-2" href="/api/templates/questions.json">
                JSON
              </a>
            </div>
          }
        />
        <div className="grid gap-6 p-5 lg:grid-cols-2">
          <div>
            <p className="mb-2 text-sm font-medium">Upload a file</p>
            <label className="flex h-40 cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-border text-center text-sm text-muted hover:border-brand">
              <input
                type="file"
                accept=".xlsx,.csv,.txt,.json"
                className="sr-only"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void handleFile(f);
                  e.target.value = "";
                }}
              />
              <span className="font-medium text-text">{busy ? "Reading…" : "Choose a file"}</span>
              <span>.xlsx, .csv, .txt or .json</span>
            </label>
          </div>
          <div>
            <p className="mb-2 text-sm font-medium">…or paste from Word</p>
            <Textarea
              rows={6}
              value={paste}
              onChange={(e) => setPaste(e.target.value)}
              placeholder={"What is 2 + 2?\nA. 3\nB. 4\nC. 5\nANSWER: B"}
              className="font-mono text-xs"
            />
            <Button variant="secondary" className="mt-2" onClick={handlePaste} disabled={!paste.trim()}>
              Check pasted questions
            </Button>
          </div>
        </div>
      </Card>

      {message ? <Alert tone={message.tone}>{message.text}</Alert> : null}

      {result ? (
        <Card>
          <CardHeader
            title={`3. Check and import — ${fileName}`}
            description={`${result.questions.length} ready · ${result.issues.length} need fixing`}
            actions={
              <Button onClick={save} disabled={pending || result.questions.length === 0 || !subjectId}>
                {pending ? "Importing…" : `Import ${result.questions.length} question${result.questions.length === 1 ? "" : "s"}`}
              </Button>
            }
          />
          {result.issues.length ? (
            <div className="border-b border-border p-5">
              <Alert tone="warning" title="These were skipped — fix them in your file and upload again:">
                <ul className="mt-1 list-disc space-y-0.5 pl-5">
                  {result.issues.slice(0, 50).map((i, idx) => (
                    <li key={idx}>
                      <strong>{i.source}:</strong> {i.message}
                    </li>
                  ))}
                </ul>
                {result.issues.length > 50 ? <p className="mt-1">…and {result.issues.length - 50} more.</p> : null}
              </Alert>
            </div>
          ) : null}
          {result.questions.length ? (
            <Table>
              <thead>
                <tr>
                  <Th>#</Th>
                  <Th className="w-1/2">Question</Th>
                  <Th>Options</Th>
                  <Th>Answer</Th>
                  <Th>Topic</Th>
                </tr>
              </thead>
              <tbody>
                {result.questions.map((q, i) => (
                  <tr key={i}>
                    <Td className="text-xs text-muted">{i + 1}</Td>
                    <Td className="whitespace-pre-wrap">{q.body}</Td>
                    <Td className="text-xs">
                      {q.options.map((o) => (
                        <span key={o.key} className={o.key === q.answer ? "block font-semibold text-success" : "block"}>
                          {o.key}. {o.text}
                        </span>
                      ))}
                    </Td>
                    <Td>
                      <Badge tone="success">{q.answer}</Badge>
                    </Td>
                    <Td className="text-xs">{q.topic ?? "—"}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ) : null}
        </Card>
      ) : null}
    </div>
  );
}
