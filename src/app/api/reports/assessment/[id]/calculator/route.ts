import { getStaff } from "@/lib/auth";
import { csvSafe, groupCalcUses } from "@/lib/calculator-log";
import { fullName, getStructure } from "@/lib/data";
import { loadAssessmentReport, loadCalculatorLog } from "@/lib/report-data";
import { toCsv } from "@/lib/reports";

/** The calculator log for one test as a spreadsheet, for review or audit. */
export async function GET(req: Request, ctx: RouteContext<"/api/reports/assessment/[id]/calculator">) {
  if (!(await getStaff())) return new Response("Not signed in", { status: 401 });
  const { id } = await ctx.params;
  const classId = new URL(req.url).searchParams.get("class") ?? undefined;
  const data = await loadAssessmentReport(id, classId);
  if (!data) return new Response("Not found", { status: 404 });
  const s = await getStructure();
  const uses = await loadCalculatorLog(data.attempts.map((a) => a.id));
  const g = groupCalcUses(uses);
  const number = new Map(data.questions.map((q, i) => [q.id, i + 1]));
  const body = new Map(data.questions.map((q) => [q.id, q.body]));

  const rows: (string | number | null)[][] = [["Admission no.", "Student", "Class", "Time (Lagos)", "Question no. in test", "Question seen as no.", "Question", "Sum", "Answer"]];
  for (const a of data.attempts) {
    const st = data.students.get(a.student_id);
    for (const u of g.byAttempt.get(a.id) ?? []) {
      rows.push([
        csvSafe(st?.admission_no ?? ""),
        csvSafe(st ? fullName(st) : ""),
        csvSafe(s.className(a.class_id)),
        new Date(u.at).toLocaleString("en-GB", { timeZone: "Africa/Lagos", hour12: false }),
        number.get(u.questionId) ?? "",
        u.shownAs,
        csvSafe((body.get(u.questionId) ?? "").slice(0, 200)),
        csvSafe(u.expr),
        csvSafe(u.result),
      ]);
    }
  }
  const name = data.assessment.title.replace(/[^\w\- ]+/g, "").trim() || "test";
  return new Response("﻿" + toCsv(rows), {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${name} calculator log.csv"` },
  });
}
