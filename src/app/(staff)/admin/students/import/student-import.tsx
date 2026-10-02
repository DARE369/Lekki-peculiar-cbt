"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import Papa from "papaparse";
import { Alert, Badge, Button, Card, CardHeader, Checkbox, Table, Td, Th } from "@/components/ui";
import { normalizeClassName, studentTable, type StudentImportRow } from "@/lib/import/students";
import { importStudents, readStudentSheet } from "../actions";

const TEMPLATE = "Admission No,First Name,Surname,Other Names,Gender,Class\nLPS/2024/0137,Charles,Okafor,Chidi,M,Year 4 Gold\n";

export function StudentImport({ classNames }: { classNames: string[] }) {
  const [rows, setRows] = useState<StudentImportRow[] | null>(null);
  const [ignored, setIgnored] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [skipUnknown, setSkipUnknown] = useState(true);
  const [reading, startReading] = useTransition();
  const [pending, start] = useTransition();

  const known = useMemo(() => new Set(classNames.map(normalizeClassName)), [classNames]);
  const hasClass = (r: StudentImportRow) => !r.class_name || known.has(normalizeClassName(r.class_name));
  const unknownClasses = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows ?? []) if (r.class_name && !known.has(normalizeClassName(r.class_name))) m.set(r.class_name, (m.get(r.class_name) ?? 0) + 1);
    return [...m].sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }));
  }, [rows, known]);
  const skipCount = skipUnknown ? unknownClasses.reduce((n, [, c]) => n + c, 0) : 0;

  function load(cells: string[][]) {
    const t = studentTable(cells);
    if ("error" in t) {
      setError(t.error);
      setRows(null);
      return;
    }
    if (t.rows.length === 0) {
      setError("The file has headings but no students.");
      setRows(null);
      return;
    }
    setError(null);
    setIgnored(t.ignored);
    setRows(t.rows);
  }

  function choose(f: File) {
    setResult(null);
    setError(null);
    if (/\.xlsx$/i.test(f.name)) {
      startReading(async () => {
        const fd = new FormData();
        fd.set("file", f);
        const r = await readStudentSheet(fd);
        if ("error" in r) {
          setError(r.error);
          setRows(null);
        } else load(r.cells);
      });
    } else if (/\.xls$/i.test(f.name)) {
      setError("This is an old Excel (.xls) file. Open it in Excel and use File → Save As → Excel Workbook (.xlsx).");
      setRows(null);
    } else {
      startReading(async () => {
        const parsed = Papa.parse<string[]>((await f.text()).replace(/^﻿/, ""), { skipEmptyLines: "greedy" });
        load(parsed.data);
      });
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader
          title="1. Choose the file"
          description="Excel (.xlsx) or CSV. The first row must be headings. Needed: the admission number (Admission No / Student ID) and the name — one Full Name column, or First Name and Surname. Optional: Other Names, Gender, Class. Other columns are ignored."
          actions={
            <a
              className="rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-surface-2"
              href={`data:text/csv;charset=utf-8,${encodeURIComponent(TEMPLATE)}`}
              download="students-template.csv"
            >
              Download template
            </a>
          }
        />
        <div className="p-5">
          <input
            type="file"
            accept=".xlsx,.xls,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) choose(f);
            }}
            className="text-sm"
          />
          {reading ? <p className="mt-3 text-sm text-muted">Reading the file…</p> : null}
          {error ? (
            <div className="mt-3">
              <Alert tone="danger">{error}</Alert>
            </div>
          ) : null}
        </div>
      </Card>
      {rows ? (
        <Card>
          <CardHeader
            title={`2. Check and import ${rows.length - skipCount} students`}
            description="Names written in capitals are tidied (OSEDO NZONONYE → Osedo Nzononye). With a Full Name column, the first word is the first name and the last word the surname. Existing students with the same admission number are updated (e.g. moved to a new class)."
            actions={
              <Button
                disabled={pending || rows.length - skipCount === 0}
                onClick={() =>
                  start(async () => {
                    const r = await importStudents(rows, { skipUnknownClasses: skipUnknown });
                    setResult(r && r.ok ? { ok: true, text: r.message ?? "Done" } : { ok: false, text: r && !r.ok ? r.error : "Failed" });
                    if (r?.ok) setRows(null);
                  })
                }
              >
                {pending ? "Importing…" : `Import ${rows.length - skipCount}`}
              </Button>
            }
          />
          <div className="space-y-3 px-5 pb-4">
            {unknownClasses.length ? (
              <Alert tone="warning">
                <p>
                  {unknownClasses.length === 1 ? "This class isn't" : "These classes aren't"} set up yet:{" "}
                  <strong>{unknownClasses.map(([c, n]) => `${c} (${n})`).join(", ")}</strong>. Create them under{" "}
                  <Link href="/admin/classes" className="font-semibold underline">
                    Classes
                  </Link>{" "}
                  with exactly these names and choose the file again — or skip those students (Pre-School classes don&apos;t sit CBT exams).
                </p>
                <div className="mt-2">
                  <Checkbox label="Skip students whose class isn't set up" checked={skipUnknown} onChange={(e) => setSkipUnknown(e.target.checked)} />
                </div>
              </Alert>
            ) : null}
            {ignored.length ? <p className="text-xs text-muted">Not imported (not used by the CBT): {ignored.join(", ")}.</p> : null}
          </div>
          <div className="max-h-[480px] overflow-y-auto">
            <Table stack>
              <thead>
                <tr>
                  <Th>Admission no.</Th>
                  <Th>First name</Th>
                  <Th>Surname</Th>
                  <Th>Other names</Th>
                  <Th>Gender</Th>
                  <Th>Class</Th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 1000).map((r, i) => (
                  <tr key={i} className={hasClass(r) ? undefined : "opacity-60"}>
                    <Td label="Admission no." className="font-mono text-xs">{r.admission_no || <Badge tone="danger">missing</Badge>}</Td>
                    <Td label="First name">{r.first_name}</Td>
                    <Td label="Surname">{r.last_name || <Badge tone="danger">missing</Badge>}</Td>
                    <Td label="Other names">{r.other_names}</Td>
                    <Td label="Gender">{r.gender}</Td>
                    <Td label="Class">
                      {r.class_name}{" "}
                      {hasClass(r) ? null : <Badge tone={skipUnknown ? "neutral" : "warning"}>{skipUnknown ? "skipped" : "no such class"}</Badge>}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        </Card>
      ) : null}
      {result ? (
        <Alert tone={result.ok ? "success" : "danger"}>
          <span className="whitespace-pre-line">{result.text}</span>
        </Alert>
      ) : null}
    </div>
  );
}
