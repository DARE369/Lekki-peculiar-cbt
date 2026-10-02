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
    <div role="status" className="rounded-2xl border border-success/40 bg-success-soft p-4 sm:p-5">
      <p className="flex items-start gap-2 font-semibold text-success">
        <CheckCircle2 className="mt-0.5 size-5 shrink-0" aria-hidden /> <span>{title}</span>
      </p>
      {children ? <p className="mt-1 pl-7 text-sm text-text/80">{children}</p> : null}
      <div className="mt-3 flex flex-wrap gap-2 pl-0 sm:pl-7">
        {(steps ?? []).map((st) => (
          <Link key={st.href + st.label} href={st.href} className={buttonClass(st.primary ? "primary" : "secondary", "md", "max-sm:w-full")}>
            {st.label}
          </Link>
        ))}
      </div>
    </div>
  );
}
