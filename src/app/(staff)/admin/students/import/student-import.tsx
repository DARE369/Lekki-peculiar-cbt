"use client";

import { useState, useTransition } from "react";
import Papa from "papaparse";
import { Alert, Button, Card, CardHeader, Table, Td, Th } from "@/components/ui";
import { importStudents } from "../actions";

const ALIASES: Record<string, string> = {
  "admission no": "admission_no",
  "admission number": "admission_no",
  admission_no: "admission_no",
  admission: "admission_no",
  "adm no": "admission_no",
  "reg no": "admission_no",
  id: "admission_no",
  "student id": "admission_no",
  "first name": "first_name",
  firstname: "first_name",
  first_name: "first_name",
  "last name": "last_name",
  lastname: "last_name",
  last_name: "last_name",
  surname: "last_name",
  "other names": "other_names",
  other_names: "other_names",
  "middle name": "other_names",
  gender: "gender",
  sex: "gender",
  class: "class_name",
  "class name": "class_name",
  class_name: "class_name",
};

type Row = Record<string, string>;

export function StudentImport() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  function load(text: string) {
    setResult(null);
    const parsed = Papa.parse<Record<string, string>>(text.replace(/^﻿/, ""), {
      header: true,
      skipEmptyLines: "greedy",
      transformHeader: (h) => ALIASES[h.trim().toLowerCase().replace(/[_.]+/g, " ").replace(/\s+/g, " ")] ?? ALIASES[h.trim().toLowerCase()] ?? h,
    });
    const fields = parsed.meta.fields ?? [];
    const missing = ["admission_no", "first_name", "last_name"].filter((f) => !fields.includes(f));
    if (missing.length) {
      setError(`Missing column(s): ${missing.join(", ")}. Use the headings: Admission No, First Name, Surname, Other Names, Gender, Class.`);
      setRows(null);
      return;
    }
    setError(null);
    setRows(parsed.data);
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader
          title="1. Choose a CSV file"
          description="Export from Excel with File → Save As → CSV. Columns: Admission No, First Name, Surname, Other Names, Gender, Class. The class must match a class name exactly (e.g. Year 4 Gold)."
          actions={
            <a
              className="rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-surface-2"
              href={`data:text/csv;charset=utf-8,${encodeURIComponent("Admission No,First Name,Surname,Other Names,Gender,Class\nLPS/2024/0137,Charles,Okafor,Chidi,M,Year 4 Gold\n")}`}
              download="students-template.csv"
            >
              Download template
            </a>
          }
        />
        <div className="p-5">
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (f) load(await f.text());
            }}
            className="text-sm"
          />
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
            title={`2. Check and import ${rows.length} students`}
            description="Existing students with the same admission number are updated (e.g. moved to a new class)."
            actions={
              <Button
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    const r = await importStudents(rows);
                    setResult(r && r.ok ? { ok: true, text: r.message ?? "Done" } : { ok: false, text: r && !r.ok ? r.error : "Failed" });
                    if (r?.ok) setRows(null);
                  })
                }
              >
                {pending ? "Importing…" : "Import"}
              </Button>
            }
          />
          <div className="max-h-[480px] overflow-y-auto">
            <Table>
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
                {rows.slice(0, 500).map((r, i) => (
                  <tr key={i}>
                    <Td className="font-mono text-xs">{r.admission_no}</Td>
                    <Td>{r.first_name}</Td>
                    <Td>{r.last_name}</Td>
                    <Td>{r.other_names}</Td>
                    <Td>{r.gender}</Td>
                    <Td>{r.class_name}</Td>
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
