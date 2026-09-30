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
