import { Calculator, FileDown, HelpCircle, UsersRound } from "lucide-react";
import { Badge, Card, CardHeader, EmptyState, Stat, Table, Td, Th } from "@/components/ui";
import { groupCalcUses, type CalcUse } from "@/lib/calculator-log";
import { fullName } from "@/lib/data";
import type { StudentLite } from "@/lib/report-data";
import type { AttemptRow, PaperQuestion } from "@/lib/reports";

const clock = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false, timeZone: "Africa/Lagos" }).format(new Date(iso));

/**
 * For review or audit: every sum students worked out on the exam calculator, and the question each was on.
 * By student (what each one did, in order) and by question (where the calculator was used most).
 */
export function CalculatorTab({
  uses,
  attempts,
  students,
  questions,
  className,
  allowed,
  csvHref,
}: {
  uses: CalcUse[];
  attempts: AttemptRow[];
  students: Map<string, StudentLite>;
  questions: PaperQuestion[];
  className: (classId: string | null) => string;
  /** false when the teacher turned the calculator off for this test */
  allowed: boolean;
  csvHref: string;
}) {
  if (uses.length === 0) {
    return (
      <Card>
        <EmptyState title={allowed ? "Nobody used the calculator" : "The calculator was turned off for this test"}>
          {allowed
            ? "When students work something out on the exam calculator, each sum and the question they were on is recorded here."
            : "Students had no calculator on this test, so there is nothing to review."}
        </EmptyState>
      </Card>
    );
  }

  const g = groupCalcUses(uses);
  const number = new Map(questions.map((q, i) => [q.id, i + 1]));
  const body = new Map(questions.map((q) => [q.id, q.body]));
  const snippet = (id: string) => {
    const b = body.get(id);
    return b ? (b.length > 90 ? `${b.slice(0, 90)}…` : b) : "A question that is no longer in this test";
  };
  const who = attempts
    .filter((a) => g.byAttempt.has(a.id))
    .map((a) => ({ a, st: students.get(a.student_id) }))
    .sort((x, y) => (x.st ? fullName(x.st) : "").localeCompare(y.st ? fullName(y.st) : ""));
  const byQuestion = [...g.questions].sort((a, b) => b.uses - a.uses || (number.get(a.questionId) ?? 999) - (number.get(b.questionId) ?? 999));

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Stat label="Students who used it" value={`${g.byAttempt.size} of ${attempts.length}`} icon={UsersRound} />
        <Stat label="Sums worked out" value={uses.length} icon={Calculator} />
        <Stat label="Questions it was used on" value={g.questions.filter((q) => number.has(q.questionId)).length} icon={HelpCircle} />
      </div>

      <Card>
        <CardHeader
          title="By student"
          description="Every sum, in the order it was worked out, with the question the student was on."
          actions={
            <a href={csvHref} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-sm hover:bg-surface-2">
              <FileDown className="size-4" aria-hidden /> Download log (CSV)
            </a>
          }
        />
        <ul className="divide-y divide-border">
          {who.map(({ a, st }) => {
            const list = g.byAttempt.get(a.id)!;
            const qs = new Set(list.map((u) => u.questionId)).size;
            return (
              <li key={a.id}>
                <details className="group">
                  <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2 px-5 py-3 hover:bg-surface-2">
                    <span className="font-medium">
                      {st ? fullName(st) : "Student"} <span className="text-sm font-normal text-muted">· {className(a.class_id)}</span>
                    </span>
                    <span className="flex items-center gap-2 text-sm text-muted">
                      {list.length} sum{list.length === 1 ? "" : "s"} on {qs} question{qs === 1 ? "" : "s"}
                      <span className="text-brand transition-transform group-open:rotate-90" aria-hidden>
                        ›
                      </span>
                    </span>
                  </summary>
                  <div className="overflow-x-auto border-t border-border px-2 pb-2">
                    <Table>
                      <thead>
                        <tr>
                          <Th>Time</Th>
                          <Th>Question</Th>
                          <Th>Sum</Th>
                          <Th>Answer</Th>
                        </tr>
                      </thead>
                      <tbody>
                        {list.map((u, i) => (
                          <tr key={i}>
                            <Td className="text-xs whitespace-nowrap text-muted tabular-nums">{clock(u.at)}</Td>
                            <Td>
                              {number.has(u.questionId) ? (
                                <>
                                  <Badge tone="brand">Q{number.get(u.questionId)}</Badge>{" "}
                                  <span className="text-sm">{snippet(u.questionId)}</span>
                                  {u.shownAs != null && u.shownAs !== number.get(u.questionId) ? (
                                    <span className="block text-xs text-muted">The student saw it as question {u.shownAs}.</span>
                                  ) : null}
                                </>
                              ) : (
                                <span className="text-sm text-muted">{u.shownAs != null ? `Question ${u.shownAs} as the student saw it` : "Unknown question"}</span>
                              )}
                            </Td>
                            <Td className="font-mono text-sm whitespace-nowrap">{u.expr}</Td>
                            <Td className="font-mono text-sm font-semibold whitespace-nowrap tabular-nums">{u.result}</Td>
                          </tr>
                        ))}
                      </tbody>
                    </Table>
                  </div>
                </details>
              </li>
            );
          })}
        </ul>
      </Card>

      <Card>
        <CardHeader title="By question" description="Where the calculator was used most. Question numbers are the original order in the test." />
        <Table>
          <thead>
            <tr>
              <Th className="w-16">No.</Th>
              <Th>Question</Th>
              <Th>Sums</Th>
              <Th>Students</Th>
            </tr>
          </thead>
          <tbody>
            {byQuestion.map((q) => (
              <tr key={q.questionId || "none"}>
                <Td className="text-muted tabular-nums">{number.get(q.questionId) ?? "—"}</Td>
                <Td className="text-sm">{snippet(q.questionId)}</Td>
                <Td className="tabular-nums">{q.uses}</Td>
                <Td className="tabular-nums">{q.students}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>

      <p className="text-xs text-muted">
        A sum is recorded when the student presses = or Enter, or when an answer stayed on the calculator&apos;s screen for a moment. Working typed in
        and cleared straight away is not recorded. The log shows what was calculated, not how the student then answered the question.
      </p>
    </div>
  );
}
