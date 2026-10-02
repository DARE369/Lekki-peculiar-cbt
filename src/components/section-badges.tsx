import { Badge } from "@/components/ui";
import type { Structure } from "@/lib/data";

/** Section labels for a person ("Elementary", "College"); "No section yet" when they have none. */
export function SectionBadges({ ids, s, empty = "No section yet" }: { ids: string[]; s: Structure; empty?: string }) {
  if (ids.length === 0) return <span className="text-xs text-muted">{empty}</span>;
  return (
    <span className="inline-flex flex-wrap gap-1">
      {ids.map((id) => (
        <Badge key={id} tone="brand">
          {s.sectionById.get(id)?.name ?? "—"}
        </Badge>
      ))}
    </span>
  );
}
