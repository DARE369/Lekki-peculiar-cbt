import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PercentBar } from "@/components/charts";
import { Avatar, Badge, Card, CardHeader, EmptyState, PageHeader, Select, Table, Td, Th, cn } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { formatDateTime, fullName, getStructure } from "@/lib/data";
import { TYPE_LABEL } from "@/lib/labels";
import { signPhotos } from "@/lib/photos";
import { ATTEMPT_COLUMNS } from "@/lib/report-data";
import { integrityFlags, percent, summarize, type AttemptRow, type PaperQuestion } from "@/lib/reports";
import { createClient } from "@/lib/supabase/server";
import type { AssessmentType } from "@/lib/types";

export const metadata: Metadata = { title: "Student record" };

type Row = AttemptRow & {
  assessments: { id: string; title: string; type: AssessmentType; subject_id: string; term_id: string; paper: { questions: PaperQuestion[] } | null } | null;
};

export default async function StudentReport(props: PageProps<"/reports/student/[id]">) {
  const { id } = await props.params;
  const sp = await props.searchParams;
  await requireStaff();
  const s = await getStructure();
  const termId = typeof sp.term === "string" ? sp.term : (s.currentTerm?.id ?? "");
  const supabase = await createClient();
  const { data: st } = await supabase
    .from("students")
    .select("id, admission_no, first_name, last_name, other_names, class_id, photo_path")
    .eq("id", id)
    .maybeSingle();
  if (!st) notFound();
  await supabase.rpc("finalize_expired_attempts");
  const { data } = await supabase
    .from("attempts")
    .select(`${ATTEMPT_COLUMNS}, assessments!inner(id, title, type, subject_id, term_id, paper)`)
    .eq("student_id", id)
    .eq("status", "submitted")
    .eq("assessments.term_id", termId)
    .order("submitted_at");
  const attempts = (data ?? []) as unknown as Row[];
  const { data: answerRows } = attempts.length
    ? await supabase.from("attempt_answers").select("attempt_id, question_id, selected").in("attempt_id", attempts.map((a) => a.id))
    : { data: [] as { attempt_id: string; question_id: string; selected: string | null }[] };
  const answers = new Map<string, Map<string, string | null>>();
  for (const r of answerRows ?? []) {
    if (!answers.has(r.attempt_id)) answers.set(r.attempt_id, new Map());
    answers.get(r.attempt_id)!.set(r.question_id, r.selected);
  }
  const photos = await signPhotos([st.photo_path]);

  const bySubject = new Map<string, Row[]>();
  for (const a of attempts) {
    const k = a.assessments!.subject_id;
    bySubject.set(k, [...(bySubject.get(k) ?? []), a]);
  }
  const subjects = [...bySubject.entries()].sort((a, b) => (s.subjectById.get(a[0])?.name ?? "").localeCompare(s.subjectById.get(b[0])?.name ?? ""));
  const overall = summarize(attempts.filter((a) => a.assessments?.type !== "practice").map(percent).filter((v): v is number => v != null), 50);

  return (
    <div className="space-y-6">
      <PageHeader
        back={{ href: st.class_id ? `/reports/class/${st.class_id}?term=${termId}` : "/reports", label: "Class broadsheet" }}
        title={
          <span className="flex items-center gap-4">
            <Avatar src={st.photo_path ? photos.get(st.photo_path) : null} name={fullName(st)} size={56} />
            <span>
              {fullName(st)}
              <span className="block text-sm font-normal text-muted">
                {s.className(st.class_id)} · {st.admission_no}
              </span>
            </span>
          </span>
        }
        actions={
          <form className="flex gap-2">
            <Select name="term" defaultValue={termId} className="w-56">
              {s.terms.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.session_name} · {t.name}
                </option>
              ))}
            </Select>
            <button className="h-10 rounded-lg border border-border px-4 text-sm hover:bg-surface-2">Show</button>
          </form>
        }
      />

      {attempts.length === 0 ? (
        <Card>
          <EmptyState title="No results this term in the subjects you can see" />
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader title="Summary by subject" description={`Overall average ${overall.mean ?? "—"}% across ${overall.count} tests and exams.`} />
            <Table stack>
              <thead>
                <tr>
                  <Th>Subject</Th>
                  <Th>Tests</Th>
                  <Th>Average</Th>
                  <Th>Each result, oldest first</Th>
                </tr>
              </thead>
              <tbody>
                {subjects.map(([subjectId, rows]) => {
                  const pcts = rows.map(percent).filter((v): v is number => v != null);
                  const sm = summarize(pcts, 50);
                  return (
                    <tr key={subjectId}>
                      <Td className="font-medium">{s.subjectById.get(subjectId)?.name}</Td>
                      <Td label="Tests" className="tabular-nums">{rows.length}</Td>
                      <Td label="Average">
                        <PercentBar value={sm.mean} />
                      </Td>
                      <Td label="Results" className="text-sm tabular-nums">
                        {rows.map((r, i) => (
                          <span key={r.id}>
                            {i ? " → " : ""}
                            <a href={`#${r.id}`} className={cn("hover:underline", (percent(r) ?? 0) < 50 && "text-danger")}>
                              {percent(r)}
                            </a>
                          </span>
                        ))}
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          </Card>

          {subjects.map(([subjectId, rows]) => (
            <section key={subjectId} className="space-y-3">
              <h2 className="text-lg font-semibold">{s.subjectById.get(subjectId)?.name}</h2>
              {rows.map((r) => {
                const a = r.assessments!;
                const questions = new Map((a.paper?.questions ?? []).map((q) => [q.id, q]));
                const mine = answers.get(r.id) ?? new Map();
                const missed = r.question_order
                  .map((o, i) => ({ q: questions.get(o.q), n: i + 1, sel: mine.get(o.q) ?? null }))
                  .filter((x) => x.q && x.sel !== x.q.answer);
                const text = (q: PaperQuestion, key: string | null) => {
                  const o = q.options.find((x) => x.key === key);
                  return o ? o.text : "No answer";
                };
                return (
                  <Card key={r.id} id={r.id} className="scroll-mt-6">
                    <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
                      <div>
                        <Link href={`/reports/assessment/${a.id}`} className="font-medium hover:underline">
                          {a.title}
                        </Link>{" "}
                        <Badge>{TYPE_LABEL[a.type]}</Badge>
                        <p className="text-xs text-muted">{formatDateTime(r.submitted_at)}</p>
                      </div>
                      <div className="flex items-center gap-4">
                        <span className="flex flex-wrap gap-1">
                          {integrityFlags(r).map((f) => (
                            <Badge key={f.label} tone={f.tone}>
                              {f.label}
                            </Badge>
                          ))}
                        </span>
                        <span className="text-lg font-semibold tabular-nums">
                          {Number(r.score)}/{Number(r.max_score)}
                        </span>
                        <PercentBar value={percent(r)} />
                      </div>
                    </div>
                    {missed.length ? (
                      <details className="border-t border-border">
                        <summary className="cursor-pointer px-5 py-3 text-sm text-brand">
                          {missed.length} question{missed.length === 1 ? "" : "s"} missed or wrong
                        </summary>
                        <ol className="divide-y divide-border">
                          {missed.map(({ q, n, sel }) => (
                            <li key={q!.id} className="px-5 py-3 text-sm">
                              <p>
                                <span className="text-muted">Q{n}.</span> {q!.body}
                              </p>
                              <p className="mt-1 text-danger">Answered: {text(q!, sel)}</p>
                              <p className="text-success">Correct: {text(q!, q!.answer)}</p>
                              {q!.topic ? <p className="text-xs text-muted">Topic: {q!.topic}</p> : null}
                            </li>
                          ))}
                        </ol>
                      </details>
                    ) : (
                      <p className="border-t border-border px-5 py-3 text-sm text-success">All correct.</p>
                    )}
                  </Card>
                );
              })}
            </section>
          ))}
        </>
      )}
    </div>
  );
}
