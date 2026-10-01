import Link from "next/link";
import { CalendarClock, CheckCircle2, Hourglass, ListChecks, Upload } from "lucide-react";
import { Card, CardHeader, LinkButton, buttonClass, cn } from "@/components/ui";
import type { Structure } from "@/lib/data";
import { daysUntil, formatDeadline, type ProgressRow } from "@/lib/onboarding";

/** The teacher's "what's left to do" card: one row per subject and year group, with a progress bar and an Upload button. */
export function UploadChecklist({ rows, s, perSubject, fallbackDeadline }: { rows: ProgressRow[]; s: Structure; perSubject: number; fallbackDeadline: string | null }) {
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
  const done = rows.filter((r) => r.done).length;
  const deadline = rows.map((r) => r.deadline).filter(Boolean).sort()[0] ?? fallbackDeadline;
  const days = deadline ? daysUntil(deadline) : null;
  return (
    <Card className={done === rows.length ? undefined : "border-brand/40"}>
      <CardHeader
        icon={ListChecks}
        title={done === rows.length ? "All your questions are in — thank you!" : "Your question upload"}
        description={`${done} of ${rows.length} done · aim for ${perSubject} questions for each subject and year group`}
      />
      {deadline && done < rows.length ? (
        <p className={cn("mx-5 mb-4 flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm", days !== null && days < 0 ? "bg-danger-soft text-danger" : "bg-accent-soft")}>
          <CalendarClock className="size-4 shrink-0" aria-hidden />
          <span>
            Deadline: <strong>{formatDeadline(deadline)}</strong>
            {days === null ? "" : days < 0 ? " — this date has passed" : days === 0 ? " — today" : ` — ${days} day${days === 1 ? "" : "s"} left`}
          </span>
        </p>
      ) : null}
      <ul className="divide-y divide-border border-t border-border">
        {rows.map((r) => {
          const pct = Math.min(100, Math.round((r.questions / r.target) * 100));
          return (
            <li key={`${r.subjectId}:${r.yearId}`} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-4">
              <div className="min-w-48 flex-1">
                <p className="font-semibold">
                  {s.subjectById.get(r.subjectId)?.name} <span className="font-medium text-muted">· {s.yearById.get(r.yearId)?.name}</span>
                </p>
                <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted">
                  {r.approved ? (
                    <>
                      <CheckCircle2 className="size-3.5 text-success" aria-hidden /> Approved
                    </>
                  ) : (
                    <>
                      <Hourglass className="size-3.5 text-warning" aria-hidden /> Waiting for approval — you can still upload
                    </>
                  )}
                </p>
                <div className="mt-2 flex items-center gap-3">
                  <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuenow={r.questions} aria-valuemax={r.target} aria-label="Questions uploaded">
                    <div className={cn("h-full rounded-full", r.done ? "bg-success" : "bg-brand")} style={{ width: `${pct}%` }} />
                  </div>
                  <span className={cn("shrink-0 text-sm font-semibold", r.done && "text-success")}>
                    {r.questions} / {r.target}
                  </span>
                </div>
              </div>
              {r.done ? (
                <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-success">
                  <CheckCircle2 className="size-4" aria-hidden /> Done
                </span>
              ) : (
                <Link href={`/teach/questions/import?subject=${r.subjectId}&year=${r.yearId}`} className={buttonClass("primary", "md")}>
                  <Upload aria-hidden /> Upload
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
