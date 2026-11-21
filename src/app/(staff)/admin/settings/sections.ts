import { can, type StaffContext } from "@/lib/auth";

export type SettingsKey = "overview" | "school" | "classes" | "rounds" | "calendar" | "approvals" | "deadlines" | "terminals";

/** Every settings page, in the order they appear, with who may open it. */
export function settingsPages(staff: StaffContext) {
  return [
    { key: "overview", label: "Overview", href: "/admin/settings", show: true },
    { key: "school", label: "School year & terms", href: "/admin/school", show: staff.isSuperAdmin },
    { key: "classes", label: "Classes & subjects", href: "/admin/classes", show: true },
    { key: "rounds", label: "Rounds", href: "/admin/rounds", show: true },
    { key: "calendar", label: "Exam calendar", href: "/admin/calendar", show: can(staff, "exam.approve") },
    { key: "approvals", label: "Approval rules", href: "/admin/settings/approvals", show: can(staff, "teachers.manage") },
    { key: "deadlines", label: "Question deadlines", href: "/admin/settings/deadlines", show: true },
    { key: "terminals", label: "Lab computers", href: "/admin/terminals", show: can(staff, "terminals.manage") },
  ].filter((p) => p.show) as { key: SettingsKey; label: string; href: string; show: boolean }[];
}

/** Paths that light up "Settings" in the sidebar. */
export const SETTINGS_PATHS = ["/admin/settings", "/admin/school", "/admin/classes", "/admin/rounds", "/admin/calendar", "/admin/terminals"];
