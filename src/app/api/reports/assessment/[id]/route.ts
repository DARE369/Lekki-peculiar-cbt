import { getStaff } from "@/lib/auth";
import { fullName, getStructure } from "@/lib/data";
import { loadAssessmentReport } from "@/lib/report-data";
import { percent, positions, toCsv } from "@/lib/reports";

export async function GET(req: Request, ctx: RouteContext<"/api/reports/assessment/[id]">) {
  if (!(await getStaff())) return new Response("Not signed in", { status: 401 });
  const { id } = await ctx.params;
  const classId = new URL(req.url).searchParams.get("class") ?? undefined;
  const data = await loadAssessmentReport(id, classId);
  if (!data) return new Response("Not found", { status: 404 });
  const s = await getStructure();
  const rank = positions(data.attempts, percent);
  const rows = [...data.attempts].sort((a, b) => (percent(b) ?? -1) - (percent(a) ?? -1));
  const csv = toCsv([
    ["Position", "Admission no.", "Student", "Class", "Score", "Max", "Percent", "Answered", "Questions", "Submitted", "Make-up"],
    ...rows.map((t) => {
      const st = data.students.get(t.student_id);
      return [
        rank.get(t) ?? "",
        st?.admission_no,
        st ? fullName(st) : "",
        s.className(t.class_id),
        t.score,
        t.max_score,
        percent(t),
        t.answered_count,
        t.total_questions,
        t.submitted_at,
        t.is_makeup ? "yes" : "",
      ];
    }),
  ]);
  const name = data.assessment.title.replace(/[^\w\- ]+/g, "").trim() || "results";
  return new Response("﻿" + csv, {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${name}.csv"` },
  });
}
