import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import { buttonClass } from "@/components/ui";

/** Shown after a form is finished: what was done, then the one or two things to do next. */
export function NextSteps({
  title,
  children,
  steps,
}: {
  title: string;
  children?: React.ReactNode;
  steps?: { href: string; label: string; primary?: boolean }[];
}) {
  return (
    <div role="status" className="rounded-lg border border-border border-l-4 border-l-success bg-surface p-4">
      <p className="flex items-start gap-2 font-semibold">
        <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-hidden /> <span>{title}</span>
      </p>
      {children ? <p className="mt-1 pl-6 text-sm text-muted">{children}</p> : null}
      <div className="mt-3 flex flex-wrap gap-2 pl-0 sm:pl-6">
        {(steps ?? []).map((st) => (
          <Link key={st.href + st.label} href={st.href} className={buttonClass(st.primary ? "primary" : "secondary", "md", "max-sm:w-full")}>
            {st.label}
          </Link>
        ))}
      </div>
    </div>
  );
}
