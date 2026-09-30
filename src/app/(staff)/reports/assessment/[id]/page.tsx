import type { Metadata } from "next";
import { Award, BarChart3, Sigma, SplitSquareHorizontal, TrendingDown, TrendingUp, UsersRound } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/forms";
import { ColumnChart, PercentBar } from "@/components/charts";
import { Alert, Badge, Card, CardHeader, EmptyState, PageHeader, Select, Stat, Table, Td, Th, cn } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { formatDateTime, fullName, getStructure } from "@/lib/data";
import { TYPE_LABEL } from "@/lib/labels";
import { loadAssessmentReport } from "@/lib/report-data";
import { distribution, integrityFlags, itemAnalysis, ordinal, percent, positions, summarize } from "@/lib/reports";
import { minutesBetween } from "@/lib/time";
import { correctAnswerKey } from "../../actions";

export const metadata: Metadata = { title: "Test results" };

export default async function AssessmentReport(props: PageProps<"/reports/assessment/[id]">) {
  const { id } = await props.params;
  const sp = await props.searchParams;
  const staff = await requireStaff();
  const s = await getStructure();
  const classId = typeof sp.class === "string" && sp.class ? sp.class : undefined;
  const tab = sp.tab === "questions" ? "questions" : sp.tab === "integrity" ? "integrity" : "results";
  const data = await loadAssessmentReport(id, classId);
  if (!data) notFound();
  const { assessment: a, attempts, questions, answers, students } = data;
  const passMark = a.settings.pass_mark;

  const pcts = attempts.map(percent).filter((v): v is number => v != null);
  const sum = summarize(pcts, passMark);
  const rank = positions(attempts, percent);
  const sorted = [...attempts].sort((x, y) => (percent(y) ?? -1) - (percent(x) ?? -1));
  const items = itemAnalysis(questions, attempts, answers);
  const canFixKey = a.created_by === staff.id || staff.isAdmin;
  const base = `/reports/assessment/${id}?${classId ? `class=${classId}&` : ""}`;
  const flagged = attempts.filter((t) => integrityFlags(t).some((f) => f.tone !== "neutral" && f.tone !== "info"));

  return (
    <div className="space-y-6">
      <PageHeader
        icon={BarChart3}
        back={{ href: "/reports", label: "Reports" }}
        title={a.title}
        description={`${s.subjectById.get(a.subject_id)?.name} · ${s.yearById.get(a.year_id)?.name} · ${TYPE_LABEL[a.type]} · pass mark ${passMark}%`}
        actions={
          <>
            <form className="flex items-center gap-2">
              {tab !== "results" ? <input type="hidden" name="tab" value={tab} /> : null}
              <Select name="class" defaultValue={classId ?? ""} className="h-9 w-44">
                <option value="">All classes</option>
                {data.classIds.map((c) => (
                  <option key={c} value={c}>
                    {s.className(c)}
                  </option>
                ))}
              </Select>
              <button className="h-9 rounded-lg border border-border px-3 text-sm">Show</button>
            </form>
            <a
              href={`/api/reports/assessment/${id}${classId ? `?class=${classId}` : ""}`}
              className="inline-flex h-9 items-center rounded-lg border border-border px-3 text-sm hover:bg-surface-2"
            >
              Download CSV
            </a>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
        <Stat label="Sat" value={sum.count} icon={UsersRound} />
        <Stat label="Average" value={sum.mean == null ? "—" : `${sum.mean}%`} icon={Sigma} />
        <Stat label="Median" value={sum.median == null ? "—" : `${sum.median}%`} icon={SplitSquareHorizontal} />
        <Stat label="Highest" value={sum.high == null ? "—" : `${sum.high}%`} icon={TrendingUp} />
        <Stat label="Lowest" value={sum.low == null ? "—" : `${sum.low}%`} icon={TrendingDown} />
        <Stat label="Passed" icon={Award} value={sum.passRate == null ? "—" : `${sum.passRate}%`} tone={sum.passRate != null && sum.passRate < 50 ? "danger" : undefined} />
      </div>

      <nav className="flex gap-1 border-b border-border text-sm">
        {[
          ["results", "Students"],
          ["questions", "Questions"],
          ["integrity", `Integrity${flagged.length ? ` (${flagged.length})` : ""}`],
        ].map(([key, label]) => (
          <Link
            key={key}
            href={`${base}tab=${key}`}
            className={cn("-mb-px border-b-2 px-4 py-2", tab === key ? "border-brand font-medium text-brand" : "border-transparent text-muted hover:text-text")}
          >
            {label}
          </Link>
        ))}
      </nav>

      {attempts.length === 0 ? (
        <Card>
          <EmptyState title="Nobody has submitted this test yet" />
        </Card>
      ) : tab === "results" ? (
        <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
          <Card>
            <Table>
              <thead>
                <tr>
                  <Th>Pos.</Th>
                  <Th>Student</Th>
                  <Th>Class</Th>
                  <Th>Score</Th>
                  <Th>%</Th>
                  <Th>Answered</Th>
                  <Th>Time</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {sorted.map((t) => {
                  const st = students.get(t.student_id);
                  const p = percent(t);
                  return (
                    <tr key={t.id}>
                      <Td className="tabular-nums">{rank.get(t) ? ordinal(rank.get(t)!) : "—"}</Td>
                      <Td>
                        {st ? (
                          <Link href={`/reports/student/${st.id}?term=${a.term_id}`} className="font-medium hover:underline">
                            {fullName(st)}
                          </Link>
                        ) : (
                          "—"
                        )}
                        {t.is_makeup ? <Badge tone="info" className="ml-2">Make-up</Badge> : null}
                      </Td>
                      <Td>{s.className(t.class_id)}</Td>
                      <Td className="tabular-nums">
                        {Number(t.score)}/{Number(t.max_score)}
                      </Td>
                      <Td>
                        <span className={cn("tabular-nums", p != null && p < passMark ? "font-medium text-danger" : "")}>{p}%</span>
                      </Td>
                      <Td className="tabular-nums">
                        {t.answered_count}/{t.total_questions}
                      </Td>
                      <Td className="text-xs text-muted tabular-nums">{t.submitted_at ? `${minutesBetween(t.started_at, t.submitted_at)} min` : "—"}</Td>
                      <Td>
                        <Link href={`/reports/student/${t.student_id}?term=${a.term_id}#${t.id}`} className="text-xs text-brand hover:underline">
                          Answers
                        </Link>
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          </Card>
          <Card className="h-fit p-5">
            <p className="mb-4 font-semibold">Score distribution</p>
            <ColumnChart data={distribution(pcts)} label="Number of students in each score band (%)" />
          </Card>
        </div>
      ) : tab === "questions" ? (
        <div className="space-y-4">
          {items.some((i) => i.suspicious) ? (
            <Alert tone="warning" title="Check the questions marked “Check key”">
              Most students chose the same wrong option. That usually means the answer key is wrong or the topic wasn&apos;t understood.
              If the key is wrong, fix it here — everyone is regraded automatically.
            </Alert>
          ) : null}
          <Card>
            <Table>
              <thead>
                <tr>
                  <Th>#</Th>
                  <Th className="w-2/5">Question</Th>
                  <Th>Correct</Th>
                  <Th>Choices (students)</Th>
                  <Th>Blank</Th>
                  {canFixKey ? <Th /> : null}
                </tr>
              </thead>
              <tbody>
                {[...items]
                  .sort((x, y) => (x.pctCorrect ?? 101) - (y.pctCorrect ?? 101))
                  .map((it) => (
                    <tr key={it.question.id} className="align-top">
                      <Td className="text-muted tabular-nums">{it.number}</Td>
                      <Td>
                        <p className="whitespace-pre-wrap">{it.question.body}</p>
                        {it.question.topic ? <p className="mt-1 text-xs text-muted">{it.question.topic}</p> : null}
                        {it.suspicious ? <Badge tone="warning" className="mt-1">Check key</Badge> : null}
                      </Td>
                      <Td>
                        <PercentBar value={it.pctCorrect} />
                        <p className="mt-1 text-xs text-muted">
                          {it.correct} of {it.seen}
                        </p>
                      </Td>
                      <Td className="text-xs">
                        {it.question.options.map((o) => (
                          <p key={o.key} className={cn(o.key === it.question.answer ? "font-semibold text-success" : o.key === it.topDistractor?.key && it.suspicious ? "text-warning" : "")}>
                            {o.key}. {o.text.slice(0, 40)} — <span className="tabular-nums">{it.optionCounts[o.key] ?? 0}</span>
                            {o.key === it.question.answer ? " ✓" : ""}
                          </p>
                        ))}
                      </Td>
                      <Td className="tabular-nums">{it.unanswered}</Td>
                      {canFixKey ? (
                        <Td>
                          <details>
                            <summary className="cursor-pointer text-xs text-brand">Fix answer key</summary>
                            <ActionForm action={correctAnswerKey} className="mt-2 flex gap-2">
                              <input type="hidden" name="assessment_id" value={a.id} />
                              <input type="hidden" name="question_id" value={it.question.id} />
                              <Select name="answer" defaultValue={it.question.answer} className="h-8 w-16">
                                {it.question.options.map((o) => (
                                  <option key={o.key}>{o.key}</option>
                                ))}
                              </Select>
                              <SubmitButton size="sm" variant="secondary" confirm="Change the correct answer and regrade every student?">
                                Regrade
                              </SubmitButton>
                            </ActionForm>
                          </details>
                        </Td>
                      ) : null}
                    </tr>
                  ))}
              </tbody>
            </Table>
          </Card>
          <p className="text-xs text-muted">Sorted hardest first. Numbers are the original question order in the test.</p>
        </div>
      ) : (
        <Card>
          <CardHeader
            title="Integrity"
            description="Signals recorded during the exam. They are prompts for a conversation, not proof — no marks are deducted automatically."
          />
          {flagged.length === 0 ? (
            <EmptyState title="Nothing unusual recorded" />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Student</Th>
                  <Th>Signals</Th>
                  <Th>Submitted</Th>
                </tr>
              </thead>
              <tbody>
                {flagged.map((t) => {
                  const st = students.get(t.student_id);
                  return (
                    <tr key={t.id}>
                      <Td className="font-medium">{st ? fullName(st) : "—"}</Td>
                      <Td>
                        <span className="flex flex-wrap gap-1">
                          {integrityFlags(t).map((f) => (
                            <Badge key={f.label} tone={f.tone}>
                              {f.label}
                            </Badge>
                          ))}
                        </span>
                      </Td>
                      <Td className="text-xs">{formatDateTime(t.submitted_at)}</Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          )}
        </Card>
      )}
    </div>
  );
}
