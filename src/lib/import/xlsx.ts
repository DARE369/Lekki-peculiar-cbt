import "server-only";
import ExcelJS from "exceljs";
import { parseTable, type ParseResult } from "./questions";

export async function parseXlsx(buffer: ArrayBuffer): Promise<ParseResult> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer);
  } catch {
    return { questions: [], issues: [{ source: "file", code: "FILE_UNREADABLE", message: "Could not read this Excel file. Save it as .xlsx and try again." }] };
  }
  // Read every sheet that has a "question" heading (the template has an instructions sheet too, which is
  // skipped). Teachers sometimes keep one sheet per test, so none may be silently ignored.
  const sheets: { name: string; rows: unknown[][] }[] = [];
  const skipped: string[] = [];
  for (const ws of wb.worksheets) {
    const rows: unknown[][] = [];
    // Keep real row numbers (empty rows included) so "row 12" matches what Excel shows.
    ws.eachRow({ includeEmpty: true }, (row, n) => {
      rows[n - 1] = (row.values as unknown[]).slice(1);
    });
    for (let i = 0; i < rows.length; i += 1) rows[i] ??= [];
    const header = (rows[0] ?? []).map((h) => cellText(h).toLowerCase());
    if (header.some((h) => h.includes("question"))) sheets.push({ name: ws.name, rows });
    else if (rows.some((r) => r.some((c) => cellText(c).trim()))) skipped.push(ws.name);
  }
  if (sheets.length === 0) {
    return { questions: [], issues: [{ source: "file", code: "NO_QUESTION_COLUMN", message: 'No sheet has a "question" column. Use the template.' }] };
  }
  const many = sheets.length > 1;
  const results = sheets.map((sh) => parseTable(sh.rows, 2, many ? `${sh.name} ` : ""));
  const notes: string[] = [];
  if (many) notes.push(`Read ${sheets.length} sheets: ${sheets.map((sh) => sh.name).join(", ")}.`);
  const ignored = skipped.filter((n) => !/how to|instruction|help|readme/i.test(n));
  if (ignored.length) notes.push(`Sheet${ignored.length === 1 ? "" : "s"} ${ignored.join(", ")} had no "Question" heading, so ${ignored.length === 1 ? "it was" : "they were"} not read.`);
  return {
    questions: results.flatMap((r) => r.questions),
    issues: results.flatMap((r) => r.issues),
    notes,
  };
}

/** First sheet as plain text cells (numbers, links and rich text flattened). */
export async function readSheetCells(buffer: ArrayBuffer): Promise<string[][] | null> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer);
  } catch {
    return null;
  }
  const ws = wb.worksheets[0];
  if (!ws) return null;
  const rows: string[][] = [];
  ws.eachRow({ includeEmpty: false }, (row) => {
    rows.push((row.values as unknown[]).slice(1).map(cellText));
  });
  return rows;
}

function cellText(v: unknown): string {
  if (v == null) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    const o = v as { text?: unknown; result?: unknown; richText?: { text: string }[] };
    if (o.richText) return o.richText.map((r) => r.text).join("");
    if (o.text != null) return cellText(o.text);
    if (o.result != null) return cellText(o.result);
    return "";
  }
  return String(v);
}
