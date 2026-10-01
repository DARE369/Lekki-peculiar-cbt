import "server-only";
import ExcelJS from "exceljs";
import { parseTable, type ParseResult } from "./questions";

export async function parseXlsx(buffer: ArrayBuffer): Promise<ParseResult> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer);
  } catch {
    return { questions: [], issues: [{ source: "file", message: "Could not read this Excel file. Save it as .xlsx and try again." }] };
  }
  // Use the first sheet that has a "question" heading (the template has an instructions sheet too).
  for (const ws of wb.worksheets) {
    const rows: unknown[][] = [];
    ws.eachRow({ includeEmpty: true }, (row) => {
      const values = row.values as unknown[];
      rows.push(values.slice(1));
    });
    const header = (rows[0] ?? []).map((h) => String(h ?? "").toLowerCase());
    if (header.some((h) => h.includes("question"))) return parseTable(rows);
  }
  return { questions: [], issues: [{ source: "file", message: 'No sheet has a "question" column. Use the template.' }] };
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
