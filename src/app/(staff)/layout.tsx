import { AppShell, type NavGroup } from "@/components/shell";
import { redirect } from "next/navigation";
import { can, needsOnboarding, requireStaff } from "@/lib/auth";
import { getStructure } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "@/app/login/actions";
import { SETTINGS_PATHS } from "./admin/settings/sections";

export default async function StaffLayout({ children }: { children: React.ReactNode }) {
  const staff = await requireStaff();
  if (needsOnboarding(staff)) redirect("/welcome");
  const s = await getStructure();
  const supabase = await createClient();

  let pendingApprovals = 0;
  let pendingAssignments = 0;
  let waitingToStart = 0;
  let resumeRequests = 0;
  if (staff.isAdmin) {
    const nowIso = new Date().toISOString();
    const [a, t, w, r] = await Promise.all([
      supabase.from("assessments").select("id", { count: "exact", head: true }).eq("status", "pending_approval"),
      supabase.from("teaching_assignments").select("id", { count: "exact", head: true }).eq("status", "requested"),
      // Exams whose time has come but that wait for someone to press Start.
      supabase
        .from("exam_windows")
        .select("id", { count: "exact", head: true })
        .eq("status", "scheduled")
        .eq("auto_start", false)
        .lte("starts_at", nowIso)
        .gt("ends_at", nowIso),
      supabase.from("resume_requests").select("id", { count: "exact", head: true }).eq("status", "pending"),
    ]);
    pendingApprovals = can(staff, "exam.approve") ? (a.count ?? 0) : 0;
    pendingAssignments = can(staff, "teachers.manage") ? (t.count ?? 0) : 0;
    waitingToStart = can(staff, "exam.start") ? (w.count ?? 0) : 0;
    resumeRequests = r.count ?? 0;
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
            { href: "/teach/questions", label: "Question bank", icon: "questions" },
            { href: "/teach/papers", label: "This term's papers", icon: "papers" },
            { href: "/teach/classes", label: "My classes", icon: "classes" },
            { href: "/teach/assessments", label: "Tests & exams", icon: "tests" },
            { href: "/reports", label: "Reports", icon: "reports" },
          ],
        },
      ];
  if (staff.isAdmin) {
    // Things that need someone today, with counts that stand out.
    const today: NavGroup = { title: "Needs you", items: [] };
    if (can(staff, "exam.approve") || can(staff, "teachers.manage"))
      today.items.push({
        href: can(staff, "exam.approve") ? "/admin/approvals" : "/admin/assignments",
        label: "Approvals",
        icon: "approvals",
        badge: pendingApprovals + pendingAssignments,
        also: ["/admin/assignments"],
      });
    today.items.push({ href: "/admin/exams", label: "Exams & live monitor", icon: "exams", badge: waitingToStart + resumeRequests, urgent: true });
    groups.push(today);

    const school: NavGroup = { title: "School", items: [] };
    school.items.push({ href: "/teach/assessments?scope=all", label: "All tests & exams", icon: "tests" });
    school.items.push({ href: "/admin/students", label: "Students", icon: "students" });
    school.items.push({ href: "/admin/progress", label: "Staff progress", icon: "progress" });
    if (staff.isSuperAdmin) school.items.push({ href: "/admin/staff", label: "Staff & permissions", icon: "staff" });
    else school.items.push({ href: "/admin/team", label: "My staff", icon: "staff" });
    groups.push(school);

    groups.push({
      title: "Setup",
      items: [
        { href: "/admin/settings", label: "Settings", icon: "settings", also: SETTINGS_PATHS },
        { href: "/admin/problems", label: "Problems", icon: "problems" },
        { href: "/admin/audit", label: "Audit log", icon: "audit" },
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
