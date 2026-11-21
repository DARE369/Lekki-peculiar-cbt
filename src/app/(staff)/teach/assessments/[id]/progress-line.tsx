import { Check } from "lucide-react";
import { cn } from "@/components/ui";
import { formatDateTime } from "@/lib/data";
import type { AssessmentStatus } from "@/lib/types";

type W = { starts_at: string; ends_at: string };

const ended = (w: W) => Date.parse(w.ends_at) <= Date.now();

/** Where this test is on its way to the students: written → sent → approved → exam dated → done. */
export function ProgressLine({ status, windows }: { status: AssessmentStatus; windows: W[] }) {
  if (status === "archived") return null;
  const first = windows.length ? windows.reduce((a, b) => (a.starts_at < b.starts_at ? a : b)) : null;
  const allEnded = windows.length > 0 && windows.every(ended);
  const reached =
    status === "draft" ? 0 : status === "changes_requested" ? 0 : status === "pending_approval" ? 1 : allEnded ? 4 : windows.length ? 3 : 2;
  const steps = [
    status === "changes_requested" ? "Changes asked for" : "Being written",
    "Sent for review",
    "Approved",
    first ? `Exam set for ${formatDateTime(first.starts_at)}` : "Exam dated",
    "Done",
  ];
  return (
    <ol className="flex flex-wrap items-center gap-x-1 gap-y-2 text-xs" aria-label="Progress">
      {steps.map((label, i) => {
        const done = i < reached || (i === 4 && reached === 4);
        const current = i === reached && reached !== 4;
        return (
          <li key={i} className="flex items-center gap-1" aria-current={current ? "step" : undefined}>
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-full border px-2.5 py-1",
                done && "border-success/40 bg-success-soft text-success",
                current && (status === "changes_requested" ? "border-danger/40 bg-danger-soft font-semibold text-danger" : "border-brand bg-brand-soft font-semibold text-brand"),
                !done && !current && "border-border text-muted",
              )}
            >
              {done ? <Check className="size-3" aria-hidden /> : null}
              {label}
            </span>
            {i < steps.length - 1 ? <span className="text-subtle" aria-hidden>→</span> : null}
          </li>
        );
      })}
    </ol>
  );
}
