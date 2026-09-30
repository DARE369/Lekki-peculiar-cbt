import { getStaff } from "@/lib/auth";
import { fullName, getStructure } from "@/lib/data";
import { loadClassAttempts, type StudentLite } from "@/lib/report-data";
import { buildBroadsheet, toCsv } from "@/lib/reports";
import { createClient } from "@/lib/supabase/server";

export async function GET(req: Request, ctx: RouteContext<"/api/reports/class/[classId]">) {
  if (!(await getStaff())) return new Response("Not signed in", { status: 401 });
  const { classId } = await ctx.params;
  const url = new URL(req.url);
  const s = await getStructure();
  const termId = url.searchParams.get("term") ?? s.currentTerm?.id ?? "";
  const subjectId = url.searchParams.get("subject") ?? "";
  const type = url.searchParams.get("type") ?? "all";
  const attempts = (await loadClassAttempts(classId, termId)).filter(
    (a) =>
      a.assessments &&
      (type === "all" ? a.assessments.type !== "practice" : a.assessments.type === type) &&
      (!subjectId || a.assessments.subject_id === subjectId),
  );
  const supabase = await createClient();
  const ids = [...new Set(attempts.map((a) => a.student_id))];
  const { data: roster } = await supabase
    .from("students")
    .select("id, admission_no, first_name, last_name, other_names, class_id, photo_path")
    .or(`class_id.eq.${classId}${ids.length ? `,id.in.(${ids.join(",")})` : ""}`);
  const students = new Map(((roster ?? []) as StudentLite[]).map((x) => [x.id, x]));
  const titles = new Map(attempts.map((a) => [a.assessments!.id, a.assessments!.title]));
  const sheet = buildBroadsheet(
    attempts.map((a) => ({ student_id: a.student_id, score: a.score, max_score: a.max_score, assessment: a.assessments! })),
    [...students.keys()],
    subjectId ? "assessment" : "subject",
    (k) => (subjectId ? (titles.get(k) ?? k) : (s.subjectById.get(k)?.name ?? k)),
  );
  const rows = [...sheet.rows].sort((a, b) => (a.position ?? 9999) - (b.position ?? 9999));
  const csv = toCsv([
    ["Position", "Admission no.", "Student", ...sheet.columns.map((c) => c.label), "Average"],
    ...rows.map((r) => {
      const st = students.get(r.studentId);
      return [r.position ?? "", st?.admission_no, st ? fullName(st) : "", ...sheet.columns.map((c) => r.cells[c.key]), r.average];
    }),
    ["", "", "Class average", ...sheet.columns.map((c) => c.classAverage), ""],
  ]);
  const name = `${s.className(classId)} broadsheet`.replace(/[^\w\- ]+/g, "");
  return new Response("﻿" + csv, {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${name}.csv"` },
  });
}
