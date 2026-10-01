import ExcelJS from "exceljs";
import JSZip from "jszip";

const EXAMPLES = [
  ["What is the powerhouse of the cell?", "Nucleus", "Mitochondria", "Ribosome", "Golgi body", "", "B", "Cells", "Easy", "Mitochondria produce energy (ATP)."],
  ["Which of these is a noble gas?", "Oxygen", "Nitrogen", "Neon", "Hydrogen", "", "C", "Periodic table", "Medium", ""],
  ["2 + 3 × 4 = ?", "20", "14", "24", "", "", "B", "Order of operations", "Easy", "Multiply before adding."],
];
const HEADERS = ["Question", "Option A", "Option B", "Option C", "Option D", "Option E", "Answer", "Topic", "Difficulty", "Explanation"];

const AIKEN = `What is the powerhouse of the cell?
A. Nucleus
B. Mitochondria
C. Ribosome
D. Golgi body
ANSWER: B
TOPIC: Cells
EXPLANATION: Mitochondria produce energy (ATP).

Which of these is a noble gas?
A. Oxygen
B. Nitrogen
C. Neon
D. Hydrogen
ANSWER: C
`;

const JSON_EXAMPLE = {
  questions: [
    {
      question: "What is the powerhouse of the cell?",
      options: ["Nucleus", "Mitochondria", "Ribosome", "Golgi body"],
      answer: "B",
      topic: "Cells",
      difficulty: "easy",
      explanation: "Mitochondria produce energy (ATP).",
    },
  ],
};

function csvCell(v: string) {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** A minimal Word document holding the plain-text example, one paragraph per line (instructions are on the upload page). */
async function wordTemplate() {
  const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const paras = [...AIKEN.trimEnd().split("\n")]
    .map((line) => `<w:p><w:r><w:t xml:space="preserve">${esc(line)}</w:t></w:r></w:p>`)
    .join("");
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
  );
  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paras}</w:body></w:document>`,
  );
  return zip.generateAsync({ type: "uint8array" });
}

export async function GET(_: Request, ctx: RouteContext<"/api/templates/[file]">) {
  const { file } = await ctx.params;
  if (file === "questions.csv") {
    const body = [HEADERS, ...EXAMPLES].map((r) => r.map(csvCell).join(",")).join("\r\n");
    return new Response("﻿" + body, {
      headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="questions-template.csv"' },
    });
  }
  if (file === "questions.txt") {
    return new Response(AIKEN, {
      headers: { "content-type": "text/plain; charset=utf-8", "content-disposition": 'attachment; filename="questions-template.txt"' },
    });
  }
  if (file === "questions.docx") {
    return new Response(Buffer.from(await wordTemplate()), {
      headers: {
        "content-type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "content-disposition": 'attachment; filename="questions-template.docx"',
      },
    });
  }
  if (file === "questions.json") {
    return new Response(JSON.stringify(JSON_EXAMPLE, null, 2), {
      headers: { "content-type": "application/json", "content-disposition": 'attachment; filename="questions-template.json"' },
    });
  }
  if (file === "questions.xlsx") {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Questions", { views: [{ state: "frozen", ySplit: 1 }] });
    ws.addRow(HEADERS);
    EXAMPLES.forEach((r) => ws.addRow(r));
    ws.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E3A8A" } };
    ws.columns.forEach((c, i) => (c.width = i === 0 ? 60 : i === 9 ? 40 : 18));
    for (let r = 2; r <= 500; r++) {
      ws.getCell(`G${r}`).dataValidation = {
        type: "list",
        allowBlank: true,
        formulae: ['"A,B,C,D,E,F"'],
        showErrorMessage: true,
        errorTitle: "Answer",
        error: "Pick the letter of the correct option (A–F).",
      };
      ws.getCell(`I${r}`).dataValidation = { type: "list", allowBlank: true, formulae: ['"Easy,Medium,Hard"'] };
    }
    const help = wb.addWorksheet("How to fill this in");
    [
      "One question per row on the Questions sheet. Delete the three example rows first.",
      "Fill options in order: A, B, then C, D… Leave unused options (E, F) empty.",
      "Answer: the letter of the correct option (A–F). You can pick it from the dropdown.",
      "Topic, Difficulty and Explanation are optional but make reports more useful.",
      "Save as .xlsx and upload it under Question bank → Upload questions.",
    ].forEach((line) => help.addRow([line]));
    help.getColumn(1).width = 100;
    const buf = await wb.xlsx.writeBuffer();
    return new Response(buf as ArrayBuffer, {
      headers: {
        "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "content-disposition": 'attachment; filename="questions-template.xlsx"',
      },
    });
  }
  return new Response("Not found", { status: 404 });
}
