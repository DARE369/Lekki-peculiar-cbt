import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Permission, StaffRole } from "@/lib/types";
import { PERMISSIONS } from "@/lib/types";

export interface StaffContext {
  id: string;
  email: string;
  fullName: string;
  role: StaffRole;
  schoolId: string;
  sectionIds: string[];
  permissions: Set<Permission>;
  isSuperAdmin: boolean;
  isAdmin: boolean;
}

/** The signed-in staff member for this request, or null. Cached per request. */
export const getStaff = cache(async (): Promise<StaffContext | null> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const [{ data: staff }, { data: perms }, { data: sections }] = await Promise.all([
    supabase.from("staff").select("id,email,full_name,role,school_id,active").eq("id", user.id).maybeSingle(),
    supabase.from("staff_permissions").select("permission").eq("staff_id", user.id),
    supabase.from("admin_sections").select("section_id").eq("staff_id", user.id),
  ]);
  if (!staff || !staff.active) return null;

  const isSuperAdmin = staff.role === "super_admin";
  const permissions = new Set<Permission>(
    isSuperAdmin
      ? (Object.keys(PERMISSIONS) as Permission[])
      : (perms ?? []).map((p: { permission: Permission }) => p.permission),
  );
  return {
    id: staff.id,
    email: staff.email,
    fullName: staff.full_name,
    role: staff.role,
    schoolId: staff.school_id,
    sectionIds: (sections ?? []).map((s: { section_id: string }) => s.section_id),
    permissions,
    isSuperAdmin,
    isAdmin: isSuperAdmin || staff.role === "admin",
  };
});

export async function requireStaff(): Promise<StaffContext> {
  const staff = await getStaff();
  if (!staff) {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    redirect(user ? "/no-access" : "/login");
  }
  return staff;
}

export async function requireAdmin(): Promise<StaffContext> {
  const staff = await requireStaff();
  if (!staff.isAdmin) redirect("/dashboard");
  return staff;
}

export async function requireSuperAdmin(): Promise<StaffContext> {
  const staff = await requireStaff();
  if (!staff.isSuperAdmin) redirect("/dashboard");
  return staff;
}

export function can(staff: StaffContext, permission: Permission) {
  return staff.permissions.has(permission);
}
