import Link from "next/link";
import { CalendarClock, CheckCircle2, FilePlus2, Hourglass, ListChecks, Upload } from "lucide-react";
import { Card, CardHeader, LinkButton, buttonClass, cn } from "@/components/ui";
import type { Structure } from "@/lib/data";
import { daysUntil, formatDeadline, type ProgressRow } from "@/lib/onboarding";

/**
 * The teacher's subjects and classes, with what they've done for each: questions in the bank and tests
 * built or sent for approval. No fixed number of questions — teachers decide how many they need.
 */
export function UploadChecklist({ rows, s, fallbackDeadline }: { rows: ProgressRow[]; s: Structure; fallbackDeadline: string | null }) {
  if (rows.length === 0) {
    return (
      <Card className="border-brand/40">
        <CardHeader icon={ListChecks} title="Start here: choose what you teach" description="Pick your subjects and classes. You can start uploading questions straight away." />
        <div className="px-5 pb-5">
          <LinkButton href="/teach/classes" size="lg">
            Choose my subjects and classes
          </LinkButton>
        </div>
      </Card>
    );
  }
  const deadline = rows.map((r) => r.deadline).filter(Boolean).sort()[0] ?? fallbackDeadline;
  const days = deadline ? daysUntil(deadline) : null;
  const submitted = rows.filter((r) => r.testsSubmitted > 0).length;
  return (
    <Card>
      <CardHeader
        icon={ListChecks}
        title="Your subjects and classes"
        description={`Tests sent for approval in ${submitted} of ${rows.length}. Upload questions in any format, then build your tests.`}
      />
      {deadline ? (
        <p className={cn("mx-5 mb-4 flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm", days !== null && days < 0 ? "bg-danger-soft text-danger" : "bg-accent-soft")}>
          <CalendarClock className="size-4 shrink-0" aria-hidden />
          <span>
            Deadline: <strong>{formatDeadline(deadline)}</strong>
            {days === null ? "" : days < 0 ? " — this date has passed" : days === 0 ? " — today" : ` — ${days} day${days === 1 ? "" : "s"} left`}
          </span>
        </p>
      ) : null}
      <ul className="divide-y divide-border border-t border-border">
        {rows.map((r) => (
          <li key={`${r.subjectId}:${r.yearId}`} className="flex flex-wrap items-center gap-x-4 gap-y-3 px-5 py-4">
            <div className="min-w-48 flex-1">
              <p className="font-semibold">
                {s.subjectById.get(r.subjectId)?.name} <span className="font-medium text-muted">· {s.yearById.get(r.yearId)?.name}</span>
              </p>
              <p className="mt-0.5 text-xs text-muted">{r.classIds.map((c) => s.className(c)).join(", ")}</p>
              <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                {r.approved ? (
                  <span className="inline-flex items-center gap-1 text-success">
                    <CheckCircle2 className="size-4" aria-hidden /> Approved
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-warning">
                    <Hourglass className="size-4" aria-hidden /> Waiting for approval — you can still upload
                  </span>
                )}
                <span>
                  <strong>{r.questions}</strong> question{r.questions === 1 ? "" : "s"} uploaded
                </span>
                {r.testsSubmitted ? (
                  <span className="font-semibold text-success">
                    {r.testsSubmitted} test{r.testsSubmitted === 1 ? "" : "s"} sent for approval
                  </span>
                ) : r.testsDraft ? (
                  <span className="text-muted">
                    {r.testsDraft} test{r.testsDraft === 1 ? "" : "s"} in progress
                  </span>
                ) : null}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link href={`/teach/questions/import?subject=${r.subjectId}&year=${r.yearId}`} className={buttonClass("primary", "md")}>
                <Upload aria-hidden /> Upload questions
              </Link>
              {r.approved ? (
                <Link href={`/teach/assessments/new?subject=${r.subjectId}&year=${r.yearId}`} className={buttonClass("secondary", "md")}>
                  <FilePlus2 aria-hidden /> Create a test
                </Link>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}
