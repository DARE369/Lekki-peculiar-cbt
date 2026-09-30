import { cn } from "@/components/ui";

/**
 * Single-series column chart (e.g. score distribution). One brand hue, thin columns with 4px
 * rounded tops anchored to the baseline, 2px gaps, recessive axis, hover tooltip per column.
 * The numbers are also available in the table views, so the chart is never the only source.
 */
export function ColumnChart({
  data,
  label,
  height = 160,
}: {
  data: { label: string; count: number }[];
  label: string;
  height?: number;
}) {
  const max = Math.max(1, ...data.map((d) => d.count));
  return (
    <figure aria-label={label}>
      <div className="flex items-end gap-[2px] border-b border-border" style={{ height }}>
        {data.map((d) => (
          <div key={d.label} className="group relative flex h-full flex-1 items-end justify-center">
            <div
              className="w-full max-w-10 rounded-t bg-brand transition-opacity group-hover:opacity-80"
              style={{ height: `${(d.count / max) * 100}%`, minHeight: d.count ? 3 : 0 }}
            />
            <span className="pointer-events-none absolute bottom-full mb-1 hidden rounded bg-text px-2 py-1 text-xs whitespace-nowrap text-bg group-hover:block">
              {d.label}%: {d.count} student{d.count === 1 ? "" : "s"}
            </span>
          </div>
        ))}
      </div>
      <div className="mt-1 flex gap-[2px] text-[10px] text-muted">
        {data.map((d) => (
          <span key={d.label} className="flex-1 text-center">
            {d.label.split("–")[0]}
          </span>
        ))}
      </div>
      <figcaption className="mt-1 text-xs text-muted">{label}</figcaption>
    </figure>
  );
}

/** Inline horizontal meter for a percentage, with the value as text beside it (never colour alone). */
export function PercentBar({ value, className }: { value: number | null; className?: string }) {
  if (value == null) return <span className="text-muted">—</span>;
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <span className="inline-block h-2 w-20 overflow-hidden rounded-full bg-surface-2" aria-hidden>
        <span className="block h-full rounded-full bg-brand" style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
      </span>
      <span className="tabular-nums">{value}%</span>
    </span>
  );
}

/** Score cell for broadsheets: text value; tinted only to flag failing marks (with the number shown). */
export function ScoreCell({ value, passMark = 50 }: { value: number | null; passMark?: number }) {
  if (value == null) return <span className="text-muted">—</span>;
  return <span className={cn("tabular-nums", value < passMark ? "font-medium text-danger" : "")}>{value}</span>;
}
