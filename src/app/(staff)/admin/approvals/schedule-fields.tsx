import { Checkbox, Field, Input } from "@/components/ui";
import type { ClassRow } from "@/lib/types";
import { isoToLagosLocal } from "@/lib/time";

export function ScheduleFields({ classes, scheduled }: { classes: ClassRow[]; scheduled: Set<string> }) {
  const tomorrow9 = new Date();
  tomorrow9.setUTCDate(tomorrow9.getUTCDate() + 1);
  tomorrow9.setUTCHours(8, 0, 0, 0); // 09:00 Lagos
  const start = isoToLagosLocal(tomorrow9);
  const end = isoToLagosLocal(new Date(tomorrow9.getTime() + 2 * 3600_000));
  return (
    <div className="space-y-4">
      <fieldset>
        <legend className="mb-2 text-sm font-medium">Classes</legend>
        {classes.length === 0 ? (
          <p className="text-sm text-muted">No classes in this year group yet. Add them under Classes &amp; subjects.</p>
        ) : (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {classes.map((c) => (
              <label
                key={c.id}
                className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm has-checked:border-brand has-checked:bg-brand-soft"
              >
                <input type="checkbox" name="class_id" value={c.id} className="accent-[var(--brand)]" defaultChecked={!scheduled.has(c.id) && classes.length <= 4} />
                {c.name}
                {scheduled.has(c.id) ? <span className="text-xs text-muted">(reschedule)</span> : null}
              </label>
            ))}
          </div>
        )}
      </fieldset>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Opens (Lagos time)">
          <Input type="datetime-local" name="starts_all" defaultValue={start} />
        </Field>
        <Field label="Closes (no new starts after this)">
          <Input type="datetime-local" name="ends_all" defaultValue={end} />
        </Field>
      </div>
      <Checkbox
        name="auto_start"
        label="Start automatically at the opening time"
        hint="Leave unticked to press Start yourself on the day (recommended — you confirm everyone is seated first)."
      />
    </div>
  );
}
