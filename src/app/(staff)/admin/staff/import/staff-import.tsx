"use client";

import { useState, useTransition } from "react";
import Papa from "papaparse";
import { Alert, Badge, Button, Card, CardHeader, Table, Td, Th } from "@/components/ui";
import { staffTable, type StaffImportRow } from "@/lib/import/staff";
import { bulkAddStaff, readStaffSheet, type BulkStaffResult } from "../actions";

const TEMPLATE =
  "Full Name,Email,Role,Section\nMrs Ada Okafor,ada.okafor@peculiarschools.com,Teacher,\nMr Tunde Bello,tunde.bello@peculiarschools.com,Head of Section,Elementary\n";

function csvCell(v: string) {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function StaffImport({ sectionNames }: { sectionNames: string[] }) {
  const [rows, setRows] = useState<StaffImportRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [method, setMethod] = useState<"invite" | "google" | "password">("invite");
  const [progress, setProgress] = useState<string | null>(null);
  const [results, setResults] = useState<BulkStaffResult[] | null>(null);
  const [reading, startReading] = useTransition();
  const [pending, start] = useTransition();

  const known = new Set(sectionNames.map((n) => n.toLowerCase()));
  const sectionProblem = (r: StaffImportRow) => {
    const bad = r.sections.filter((x) => !known.has(x.toLowerCase()));
    return bad.length ? `Unknown section "${bad.join(", ")}" — use ${sectionNames.join(" or ")}` : undefined;
  };
  const checked = (rows ?? []).map((r) => ({ ...r, problem: r.problem ?? sectionProblem(r) }));
  const good = checked.filter((r) => !r.problem);

  function load(cells: string[][]) {
    const t = staffTable(cells);
    if ("error" in t) {
      setError(t.error);
      setRows(null);
    } else if (t.rows.length === 0) {
      setError("The file has headings but no staff.");
      setRows(null);
    } else {
      setError(null);
      setRows(t.rows);
    }
  }

  function choose(f: File) {
    setResults(null);
    setError(null);
    startReading(async () => {
      if (/\.xlsx$/i.test(f.name)) {
        const fd = new FormData();
        fd.set("file", f);
        const r = await readStaffSheet(fd);
        if ("error" in r) setError(r.error);
        else load(r.cells);
      } else if (/\.xls$/i.test(f.name)) {
        setError("This is an old Excel (.xls) file. Open it in Excel and use File → Save As → Excel Workbook (.xlsx).");
      } else {
        load(Papa.parse<string[]>((await f.text()).replace(/^﻿/, ""), { skipEmptyLines: "greedy" }).data);
      }
    });
  }

  function download() {
    const lines = [["Name", "Email", "Status", "Note", "Temporary password"].join(",")];
    for (const r of results ?? []) lines.push([r.full_name, r.email, r.status, r.note, r.password ?? ""].map(csvCell).join(","));
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([lines.join("\n") + "\n"], { type: "text/csv" }));
    a.download = "staff-accounts.csv";
    a.click();
  }

  if (results) {
    const added = results.filter((r) => r.status === "added").length;
    const withPasswords = results.some((r) => r.password);
    return (
      <div className="space-y-6">
        <Alert tone={added ? "success" : "warning"}>
          Added {added} of {results.length}.{" "}
          {withPasswords
            ? "Download the list now — the temporary passwords are shown only once. Give each person theirs privately; they can change it under My account."
            : results.some((r) => r.note.includes("invitation emailed"))
              ? "Invitations are on their way. Each one has an Accept invitation button and the steps for their role. Anyone who misses it can use Forgot password? on the sign-in page."
              : "They can sign in with Continue with Google using their school email."}
        </Alert>
        <Card>
          <CardHeader
            title="Results"
            actions={
              <div className="flex gap-2">
                <Button variant="secondary" size="sm" onClick={download}>
                  Download list (CSV)
                </Button>
                <Button variant="ghost" size="sm" onClick={() => (setResults(null), setRows(null))}>
                  Add more
                </Button>
              </div>
            }
          />
          <Table stack>
            <thead>
              <tr>
                <Th>Name</Th>
                <Th>Email</Th>
                <Th>Result</Th>
                {withPasswords ? <Th>Temporary password</Th> : null}
              </tr>
            </thead>
            <tbody>
              {results.map((r) => (
                <tr key={r.email + r.full_name}>
                  <Td>{r.full_name}</Td>
                  <Td label="Email" className="text-xs">{r.email}</Td>
                  <Td label="Result">
                    <Badge tone={r.status === "added" ? "success" : r.status === "skipped" ? "neutral" : "danger"}>{r.status}</Badge>{" "}
                    <span className="text-xs text-muted">{r.note}</span>
                  </Td>
                  {withPasswords ? <Td label="Password" className="font-mono text-sm">{r.password ?? "—"}</Td> : null}
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader
          title="1. Choose the file"
          description={`Excel (.xlsx) or CSV with a heading row. Needed: Full Name (or First Name and Surname) and Email. Optional: Role — Teacher (the default) or Head of Section — and, for Heads of Section, Section (${sectionNames.join(" or ")}). Heads of Section get the usual admin permissions; adjust anyone afterwards.`}
          actions={
            <a
              className="rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-surface-2"
              href={`data:text/csv;charset=utf-8,${encodeURIComponent(TEMPLATE)}`}
              download="staff-template.csv"
            >
              Download template
            </a>
          }
        />
        <div className="p-5">
          <input
            type="file"
            aria-label="Staff spreadsheet"
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
            title={`2. Check and add ${good.length} staff`}
            description={checked.length > good.length ? `${checked.length - good.length} row(s) have a problem and will be left out — fix them in the file and choose it again, or add them later.` : undefined}
          />
          <div className="space-y-3 px-5 pb-4">
            <fieldset className="space-y-2 text-sm">
              <legend className="mb-1 font-medium">How will they sign in?</legend>
              <label className="flex items-start gap-2">
                <input type="radio" name="method" checked={method === "invite"} onChange={() => setMethod("invite")} className="mt-1 accent-[var(--brand)]" />
                <span>
                  <span className="font-medium">Email each person an invitation</span>
                  <span className="block text-xs text-muted">
                    Uses the school&apos;s invitation email with their role and what to do next. Supabase limits emails per hour — raise it under
                    Authentication → Rate Limits before inviting everyone.
                  </span>
                </span>
              </label>
              <label className="flex items-start gap-2">
                <input type="radio" name="method" checked={method === "google"} onChange={() => setMethod("google")} className="mt-1 accent-[var(--brand)]" />
                <span>
                  <span className="font-medium">Continue with Google</span>
                  <span className="block text-xs text-muted">No passwords to hand out. Needs Google sign-in switched on in Supabase. You can still reset anyone&apos;s password later.</span>
                </span>
              </label>
              <label className="flex items-start gap-2">
                <input type="radio" name="method" checked={method === "password"} onChange={() => setMethod("password")} className="mt-1 accent-[var(--brand)]" />
                <span>
                  <span className="font-medium">Temporary passwords</span>
                  <span className="block text-xs text-muted">One per person, shown once with a download, for you to hand out.</span>
                </span>
              </label>
            </fieldset>
            <Button
              disabled={pending || good.length === 0}
              onClick={() =>
                start(async () => {
                  // Small batches keep each request short and show progress.
                  const all: BulkStaffResult[] = [];
                  const list = good.map(({ full_name, email, role, sections }) => ({ full_name, email, role, sections }));
                  for (let i = 0; i < list.length; i += 10) {
                    setProgress(`${Math.min(i, list.length)} of ${list.length} done…`);
                    const r = await bulkAddStaff(list.slice(i, i + 10), method);
                    if ("error" in r) {
                      setError(r.error);
                      break;
                    }
                    all.push(...r.results);
                  }
                  setProgress(null);
                  if (all.length) setResults(all);
                })
              }
            >
              {pending ? `Adding staff… ${progress ?? ""}` : method === "invite" ? `Add and invite ${good.length} staff` : `Add ${good.length} staff`}
            </Button>
          </div>
          <div className="max-h-[480px] overflow-y-auto">
            <Table stack>
              <thead>
                <tr>
                  <Th>Name</Th>
                  <Th>Email</Th>
                  <Th>Role</Th>
                  <Th>Section</Th>
                </tr>
              </thead>
              <tbody>
                {checked.map((r, i) => (
                  <tr key={i} className={r.problem ? "bg-danger-soft/40" : undefined}>
                    <Td>
                      {r.full_name || "—"}
                      {r.problem ? <span className="block text-xs text-danger">{r.problem}</span> : null}
                    </Td>
                    <Td label="Email" className="text-xs">{r.email}</Td>
                    <Td label="Role">{r.role === "admin" ? <Badge tone="info">Head of Section</Badge> : "Teacher"}</Td>
                    <Td label="Section" className="text-xs">{r.sections.join(", ") || "—"}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
