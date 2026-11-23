import { ActionForm, SubmitButton } from "@/components/forms";
import { Badge, Card } from "@/components/ui";
import type { ResultsOverride } from "@/lib/results-policy";
import { setSchoolResults } from "@/app/(staff)/admin/actions";

const OPTIONS = [
  {
    mode: "each",
    label: "Each exam decides",
    hint: "Use the switch on each exam",
  },
  {
    mode: "hide",
    label: "Hide for everyone",
    hint: "Only a congratulations message",
  },
  {
    mode: "show",
    label: "Show for everyone",
    hint: "Every student sees their score",
  },
] as const;

/** What students see after submitting, for the whole school. Beats the switch on each exam. */
export function ResultsPolicy({
  value,
  canChange,
}: {
  value: ResultsOverride;
  canChange: boolean;
}) {
  const current = value ?? "each";
  return (
    <Card className="px-5 py-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="font-semibold">Results for students, school-wide</p>
          <p className="text-sm text-muted">
            {current === "hide"
              ? "Hidden for every exam: after submitting, students see only a congratulations message. This overrides each exam's own switch."
              : current === "show"
                ? "Shown for every exam: students see their score. This overrides each exam's own switch."
                : "Each exam decides, using the switch on its own page."}
          </p>
          {!canChange ? (
            <p className="mt-1 text-xs text-muted">
              Only the super admin can change this.
            </p>
          ) : null}
        </div>
        {!canChange ? (
          <Badge
            tone={
              current === "each"
                ? "neutral"
                : current === "hide"
                  ? "warning"
                  : "success"
            }
            dot
          >
            {OPTIONS.find((o) => o.mode === current)!.label}
          </Badge>
        ) : (
          <ActionForm action={setSchoolResults} className="max-w-full">
            <div className="inline-flex flex-wrap gap-1 rounded-lg border border-border bg-surface-2 p-1">
              {OPTIONS.map((o) => (
                <SubmitButton
                  key={o.mode}
                  name="mode"
                  value={o.mode}
                  size="sm"
                  variant={current === o.mode ? "primary" : "ghost"}
                  className={current === o.mode ? "pointer-events-none" : ""}
                  pendingText="Saving…"
                >
                  {o.label}
                </SubmitButton>
              ))}
            </div>
          </ActionForm>
        )}
      </div>
    </Card>
  );
}
