import Link from "next/link";
import { Logo } from "@/components/brand";
import { StaffNav, type NavGroup } from "@/components/staff-nav";
import { can, requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "@/app/login/actions";

export default async function StaffLayout({ children }: { children: React.ReactNode }) {
  const staff = await requireStaff();
  const supabase = await createClient();

  let pendingApprovals = 0;
  let pendingAssignments = 0;
  if (staff.isAdmin) {
    const [a, t] = await Promise.all([
      supabase.from("assessments").select("id", { count: "exact", head: true }).eq("status", "pending_approval"),
      supabase.from("teaching_assignments").select("id", { count: "exact", head: true }).eq("status", "requested"),
    ]);
    pendingApprovals = can(staff, "exam.approve") ? (a.count ?? 0) : 0;
    pendingAssignments = can(staff, "teachers.manage") ? (t.count ?? 0) : 0;
  }

  const groups: NavGroup[] = [
    {
      title: "Teaching",
      items: [
        { href: "/dashboard", label: "Dashboard" },
        { href: "/teach/classes", label: "My classes" },
        { href: "/teach/questions", label: "Question bank" },
        { href: "/teach/assessments", label: "Tests & exams" },
        { href: "/reports", label: "Reports" },
      ],
    },
  ];
  if (staff.isAdmin) {
    const admin: NavGroup = { title: "Administration", items: [] };
    if (can(staff, "exam.approve")) admin.items.push({ href: "/admin/approvals", label: "Approvals", badge: pendingApprovals });
    admin.items.push({ href: "/admin/exams", label: "Exams & live monitor" });
    admin.items.push({ href: "/admin/students", label: "Students" });
    admin.items.push({ href: "/admin/assignments", label: "Teaching assignments", badge: pendingAssignments });
    admin.items.push({ href: "/admin/classes", label: "Classes & subjects" });
    if (can(staff, "terminals.manage")) admin.items.push({ href: "/admin/terminals", label: "Lab computers" });
    admin.items.push({ href: "/admin/audit", label: "Audit log" });
    groups.push(admin);
  }
  if (staff.isSuperAdmin) {
    groups.push({
      title: "Super admin",
      items: [
        { href: "/admin/staff", label: "Staff & permissions" },
        { href: "/admin/school", label: "Sessions & terms" },
      ],
    });
  }

  const roleLabel = staff.isSuperAdmin ? "Super admin" : staff.role === "admin" ? "Head of Section" : "Teacher";

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[260px_1fr]">
      <aside className="no-print border-b border-border bg-surface lg:sticky lg:top-0 lg:h-screen lg:overflow-y-auto lg:border-r lg:border-b-0">
        <div className="flex items-center justify-between px-4 py-4 lg:block">
          <Link href="/dashboard">
            <Logo />
          </Link>
          <details className="lg:hidden">
            <summary className="cursor-pointer rounded-lg border border-border px-3 py-1.5 text-sm">Menu</summary>
            <div className="absolute right-4 left-4 z-20 mt-2 rounded-xl border border-border bg-surface p-4 shadow-lg">
              <StaffNav groups={groups} />
            </div>
          </details>
        </div>
        <div className="hidden px-3 pb-6 lg:block">
          <StaffNav groups={groups} />
        </div>
      </aside>
      <div className="min-w-0">
        <header className="no-print flex items-center justify-end gap-4 border-b border-border bg-surface px-4 py-3 sm:px-8">
          <Link href="/account" className="text-right text-sm leading-tight hover:underline">
            <span className="block font-medium">{staff.fullName}</span>
            <span className="block text-xs text-muted">{roleLabel}</span>
          </Link>
          <form action={signOut}>
            <button className="rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-surface-2">Sign out</button>
          </form>
        </header>
        <main className="mx-auto max-w-7xl px-4 py-8 sm:px-8">{children}</main>
      </div>
    </div>
  );
}
