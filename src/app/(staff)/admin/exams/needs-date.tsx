import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Badge, Card, Checkbox, EmptyState, Field, Input, cn } from "@/components/ui";
import type { Structure } from "@/lib/data";
import { TYPE_LABEL } from "@/lib/labels";
import { roundOf } from "@/lib/rounds";
import type { AssessmentType } from "@/lib/types";
import type { RoundConfig } from "@/lib/data";
import { bulkScheduleBySubject } from "./actions";

export type NeedsDateTest = {
  id: string;
  title: string;
  type: AssessmentType;
  subject_id: string;
  year_id: string;
  round_id: string | null;
  sequence_label: string | null;
  question_count: number;
  duration_minutes: number;
  class_ids: string[] | null;
  staff: { full_name: string } | null;
  /** Questions in the test's pool (more than each student gets when the pool is bigger). */
  pool: number;
};

export type GroupBy = "subject" | "year";

/**
 * Approved tests that still need a date, laid out as cards side by side. Grouped by subject (all of a subject's
 * tests together) or by year group (everything one year group sits). Each card says what the test is: round,
 * number of questions, time and who set it. One date and time per group schedules every ticked class in it.
 */
export function NeedsDate({ tests, groupBy, s, rounds }: { tests: NeedsDateTest[]; groupBy: GroupBy; s: Structure; rounds: RoundConfig[] }) {
  if (tests.length === 0) {
    return (
      <Card>
        <EmptyState title="All approved tests have a date set">Every approved test has been scheduled. Check Today or Upcoming.</EmptyState>
      </Card>
    );
  }

  const roundOrder = new Map(rounds.map((r) => [r.id, r.sort_order ?? 0]));
  const subjectName = (id: string) => s.subjectById.get(id)?.name ?? "Subject";
  const year = (id: string) => s.yearById.get(id);
  const roundLabel = (t: NeedsDateTest) => roundOf(t, rounds)?.label ?? t.sequence_label ?? null;

  type Group = { key: string; name: string; sort: string; tests: NeedsDateTest[] };
  const groups = new Map<string, Group>();
  for (const t of tests) {
    const key = groupBy === "subject" ? t.subject_id : t.year_id;
    const name = groupBy === "subject" ? subjectName(t.subject_id) : (year(t.year_id)?.name ?? "Year group");
    const sort = groupBy === "subject" ? name : String(year(t.year_id)?.level ?? 99).padStart(3, "0");
    if (!groups.has(key)) groups.set(key, { key, name, sort, tests: [] });
    groups.get(key)!.tests.push(t);
  }
  const ordered = [...groups.values()].sort((a, b) => a.sort.localeCompare(b.sort, undefined, { numeric: true }));
  for (const g of ordered) {
    g.tests.sort((a, b) => {
      // Inside a subject: by year group, then by round. Inside a year group: by subject, then by round.
      const first =
        groupBy === "subject"
          ? (year(a.year_id)?.level ?? 0) - (year(b.year_id)?.level ?? 0)
          : subjectName(a.subject_id).localeCompare(subjectName(b.subject_id));
      if (first) return first;
      return (roundOrder.get(a.round_id ?? "") ?? 99) - (roundOrder.get(b.round_id ?? "") ?? 99) || a.title.localeCompare(b.title);
    });
  }

  return (
    <div className="stagger space-y-6">
      {ordered.map((g) => {
        const formId = `schedule-${g.key}`;
        return (
          <Card key={g.key} className="overflow-hidden">
            <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border bg-surface-2/50 px-4 py-3 sm:px-5">
              <h2 className="text-[15px] font-semibold">{g.name}</h2>
              <p className="text-sm text-muted">
                {g.tests.length} test{g.tests.length === 1 ? "" : "s"} waiting for a date
              </p>
            </div>

            {/* The tests, side by side. Their class boxes belong to the form below (the `form` attribute). */}
            <div className="grid gap-3 p-4 sm:grid-cols-2 sm:p-5 xl:grid-cols-3">
              {g.tests.map((t) => {
                const classes = s.classes.filter((c) => c.year_id === t.year_id && c.active);
                const chosen = new Set(t.class_ids ?? []);
                const preselect = (id: string) => (chosen.size ? chosen.has(id) : true);
                const round = roundLabel(t);
                const teacher = t.staff?.full_name ?? "Unknown teacher";
                return (
                  <article key={t.id} className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
                    <div className="min-w-0">
                      <h3 className="font-semibold leading-snug">{t.title}</h3>
                      <p className="mt-0.5 text-sm text-muted">
                        {groupBy === "subject" ? (year(t.year_id)?.name ?? "—") : subjectName(t.subject_id)}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {round ? <Badge tone="brand">{round}</Badge> : <Badge tone="neutral">No round</Badge>}
                      <Badge tone="neutral">{TYPE_LABEL[t.type]}</Badge>
                    </div>
                    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
                      <dt className="text-muted">Questions</dt>
                      <dd>
                        {t.question_count}
                        {t.pool > t.question_count ? <span className="text-muted"> (from a pool of {t.pool})</span> : null}
                      </dd>
                      <dt className="text-muted">Time</dt>
                      <dd>{t.duration_minutes} minutes</dd>
                      <dt className="text-muted">Set by</dt>
                      <dd className="min-w-0 truncate" title={teacher}>
                        {teacher}
                      </dd>
                    </dl>
                    <fieldset className="mt-auto">
                      <legend className="mb-1.5 text-xs font-medium text-muted">Classes</legend>
                      {classes.length === 0 ? (
                        <p className="text-xs text-muted">No classes in this year group yet.</p>
                      ) : (
                        <div className="flex flex-wrap gap-1.5">
                          {classes.map((c) => (
                            <label
                              key={c.id}
                              className="flex cursor-pointer items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-sm transition-colors has-checked:border-brand has-checked:bg-brand-soft"
                            >
                              <input
                                type="checkbox"
                                form={formId}
                                name="pair"
                                value={`${t.id}:${c.id}`}
                                defaultChecked={preselect(c.id)}
                                className="accent-[var(--brand)]"
                              />
                              {c.name}
                            </label>
                          ))}
                        </div>
                      )}
                    </fieldset>
                    <Link href={`/admin/approvals/${t.id}`} className="text-xs font-semibold text-brand hover:underline">
                      Different date for this test →
                    </Link>
                  </article>
                );
              })}
            </div>

            <ActionForm id={formId} action={bulkScheduleBySubject} className="space-y-3 border-t border-border bg-surface-2/40 p-4 sm:p-5">
              <input type="hidden" name="group" value={groupBy} />
              <p className="text-sm">
                <span className="font-semibold">One date for everything ticked above.</span>{" "}
                <span className="text-muted">Untick any class you don&apos;t want included.</span>
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Opens (Lagos time)">
                  <Input type="datetime-local" name="starts_all" />
                </Field>
                <Field label="Closes (no new starts after this)">
                  <Input type="datetime-local" name="ends_all" />
                </Field>
              </div>
              <Checkbox name="manual_start" label="I'll press Start myself" hint="Otherwise each exam starts by itself at its opening time." />
              <SubmitButton pendingText="Scheduling…">Schedule {g.name}</SubmitButton>
            </ActionForm>
          </Card>
        );
      })}
    </div>
  );
}

/** Switch between grouping by subject and by year group. */
export function GroupToggle({ groupBy }: { groupBy: GroupBy }) {
  const options: [GroupBy, string][] = [
    ["subject", "By subject"],
    ["year", "By year group"],
  ];
  return (
    <nav aria-label="Group tests" className="inline-flex gap-1 rounded-lg border border-border bg-surface p-1 text-sm">
      {options.map(([key, label]) => (
        <Link
          key={key}
          href={`/admin/exams?view=drafts&group=${key}`}
          aria-current={groupBy === key ? "page" : undefined}
          className={cn("rounded-md px-3 py-1.5 transition-colors", groupBy === key ? "bg-brand font-medium text-brand-ink" : "text-muted hover:bg-surface-2 hover:text-text")}
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}
