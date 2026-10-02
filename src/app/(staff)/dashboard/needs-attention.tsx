import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { SubmitButton } from "@/components/forms";
import { Badge, Card, CardHeader, buttonClass } from "@/components/ui";
import { flagLabel } from "@/lib/readiness";
import { beginCorrection } from "../teach/actions";

export interface AttentionItem {
  id: string;
  title: string;
  subject: string;
  kind: "flag" | "back";
  category: string | null;
  note: string | null;
  amending: boolean;
  correctionsSent: boolean;
}

/** The teacher's tests that were approved with a flag, or sent back, with what to do about each. */
export function NeedsAttention({ items }: { items: AttentionItem[] }) {
  if (items.length === 0) return null;
  return (
    <Card className="border-warning/50">
      <CardHeader icon={AlertTriangle} title="Tests that need a second look" description="Your Head of Section asked for changes to these." />
      <ul className="divide-y divide-border border-t border-border">
        {items.map((i) => (
          <li key={i.id} className="space-y-2 px-5 py-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold">{i.title}</span>
              <span className="text-sm text-muted">{i.subject}</span>
              <Badge tone={i.kind === "flag" ? "warning" : "danger"}>{i.kind === "flag" ? "Approved, needs corrections" : "Sent back"}</Badge>
            </div>
            <p className="text-sm">
              {i.kind === "flag" ? <strong>{flagLabel(i.category)}</strong> : null}
              {i.note ? <span>{i.kind === "flag" ? " — " : ""}{i.note}</span> : null}
            </p>
            {i.kind === "flag" ? (
              i.correctionsSent ? (
                <p className="text-sm text-muted">You sent your corrections. Your Head of Section will accept them.</p>
              ) : i.amending ? (
                <Link href={`/teach/assessments/${i.id}`} className={buttonClass("primary", "md", "max-sm:w-full")}>
                  Continue correcting
                </Link>
              ) : (
                <form action={beginCorrection}>
                  <input type="hidden" name="id" value={i.id} />
                  <SubmitButton pendingText="Opening…" className="max-sm:w-full">
                    Correct this test
                  </SubmitButton>
                </form>
              )
            ) : (
              <Link href={`/teach/assessments/${i.id}`} className={buttonClass("primary", "md", "max-sm:w-full")}>
                Make the changes
              </Link>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}
