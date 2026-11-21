import Link from "next/link";
import { cn } from "@/components/ui";
import { can, type StaffContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

/** One Approvals inbox: tests to review, teaching requests and approved tests, each with its count. */
export async function InboxTabs({ staff, active }: { staff: StaffContext; active: "tests" | "requests" | "approved" }) {
  const supabase = await createClient();
  const [t, r] = await Promise.all([
    supabase.from("assessments").select("id", { count: "exact", head: true }).eq("status", "pending_approval"),
    supabase.from("teaching_assignments").select("id", { count: "exact", head: true }).eq("status", "requested"),
  ]);
  const tabs = [
    can(staff, "exam.approve") ? { key: "tests", label: "Tests to review", count: t.count ?? 0, href: "/admin/approvals" } : null,
    { key: "requests", label: "Teaching requests", count: can(staff, "teachers.manage") ? (r.count ?? 0) : 0, href: "/admin/assignments" },
    can(staff, "exam.approve") ? { key: "approved", label: "Approved tests", count: 0, href: "/admin/approvals?tab=approved" } : null,
  ].filter(Boolean) as { key: string; label: string; count: number; href: string }[];
  return (
    <nav className="flex flex-wrap gap-1 rounded-lg border border-border bg-surface p-1 text-sm" aria-label="Approvals">
      {tabs.map((x) => (
        <Link
          key={x.key}
          href={x.href}
          aria-current={x.key === active ? "page" : undefined}
          className={cn("inline-flex items-center gap-2 rounded-md px-4 py-1.5", x.key === active ? "bg-brand text-brand-ink" : "hover:bg-surface-2")}
        >
          {x.label}
          {x.count ? (
            <span className={cn("rounded-full px-1.5 text-xs font-semibold tabular-nums", x.key === active ? "bg-white/20" : "bg-brand-soft text-brand")}>{x.count}</span>
          ) : null}
        </Link>
      ))}
    </nav>
  );
}
