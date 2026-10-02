import { AppShell, type NavGroup } from "@/components/shell";
import { redirect } from "next/navigation";
import { can, needsOnboarding, requireStaff } from "@/lib/auth";
import { getStructure } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "@/app/login/actions";

export default async function StaffLayout({ children }: { children: React.ReactNode }) {
  const staff = await requireStaff();
  if (needsOnboarding(staff)) redirect("/welcome");
  const s = await getStructure();
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

  // The super admin runs the school rather than teaching, so they get no Teaching menu.
  const groups: NavGroup[] = staff.isSuperAdmin
    ? [
        {
          title: "Overview",
          items: [
            { href: "/dashboard", label: "Dashboard", icon: "dashboard" },
            { href: "/reports", label: "Reports", icon: "reports" },
          ],
        },
      ]
    : [
        {
          title: "Teaching",
          items: [
            { href: "/dashboard", label: "Dashboard", icon: "dashboard" },
            { href: "/teach/classes", label: "My classes", icon: "classes" },
            { href: "/teach/questions", label: "Question bank", icon: "questions" },
            { href: "/teach/assessments", label: "Tests & exams", icon: "tests" },
            { href: "/reports", label: "Reports", icon: "reports" },
          ],
        },
      ];
  if (staff.isAdmin) {
    const admin: NavGroup = { title: "Administration", items: [] };
    if (can(staff, "exam.approve")) admin.items.push({ href: "/admin/approvals", label: "Approvals", icon: "approvals", badge: pendingApprovals });
    admin.items.push({ href: "/admin/exams", label: "Exams & live monitor", icon: "exams" });
    admin.items.push({ href: "/admin/students", label: "Students", icon: "students" });
    admin.items.push({ href: "/admin/assignments", label: "Teaching assignments", icon: "assignments", badge: pendingAssignments });
    admin.items.push({ href: "/admin/progress", label: "Staff progress", icon: "progress" });
    if (!staff.isSuperAdmin) admin.items.push({ href: "/admin/team", label: "My staff", icon: "staff" });
    admin.items.push({ href: "/admin/classes", label: "Classes & subjects", icon: "structure" });
    if (can(staff, "terminals.manage")) admin.items.push({ href: "/admin/terminals", label: "Lab computers", icon: "terminals" });
    admin.items.push({ href: "/admin/audit", label: "Audit log", icon: "audit" });
    groups.push(admin);
  }
  if (staff.isSuperAdmin) {
    groups.push({
      title: "Super admin",
      items: [
        { href: "/admin/staff", label: "Staff & permissions", icon: "staff" },
        { href: "/admin/school", label: "Sessions & terms", icon: "sessions" },
      ],
    });
  }

  const roleLabel = staff.isSuperAdmin ? "Super admin" : staff.role === "admin" ? "Head of Section" : "Teacher";
  const term = s.currentTerm ? `${s.currentTerm.session_name} · ${s.currentTerm.name}` : null;

  return (
    <AppShell groups={groups} user={{ name: staff.fullName, role: roleLabel, term }} signOut={signOut}>
      {children}
    </AppShell>
  );
}
