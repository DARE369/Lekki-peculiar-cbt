import "server-only";
import { brand } from "@/lib/brand";
import { siteOrigin } from "@/lib/site";
import type { createAdminClient } from "@/lib/supabase/server";
import type { StaffRole } from "@/lib/types";

type Admin = ReturnType<typeof createAdminClient>;

export async function findAuthUserId(admin: Admin, email: string): Promise<string | null> {
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error || !data) return null;
    const hit = data.users.find((u) => u.email?.toLowerCase() === email);
    if (hit) return hit.id;
    if (data.users.length < 1000) return null;
  }
  return null;
}

/** Extra details the invitation email template can use: {{ .Data.full_name }}, {{ .Data.role }} etc. */
export function inviteData(fullName: string, role: StaffRole, sectionNames: string[]) {
  const words = fullName.split(/\s+/).filter(Boolean);
  const titles = /^(mr|mrs|ms|miss|dr|prof|pastor|rev)\.?$/i;
  return {
    full_name: fullName,
    first_name: (titles.test(words[0] ?? "") ? words.slice(0, 2).join(" ") : words[0]) ?? fullName,
    role,
    role_label: role === "super_admin" ? "Super admin" : role === "admin" ? "Head of Section" : "Teacher",
    sections: sectionNames.join(", "),
    school: brand.schoolName,
  };
}

/**
 * Sends Supabase's invitation email (customise it under Authentication → Email Templates → Invite user; a ready-made
 * template is in docs/email-templates/invite.html). Returns the new sign-in account, or why it failed.
 */
export async function inviteLogin(
  admin: Admin,
  email: string,
  data: ReturnType<typeof inviteData>,
): Promise<{ userId: string; reused: boolean } | { error: string; rateLimited?: boolean }> {
  const { data: res, error } = await admin.auth.admin.inviteUserByEmail(email, {
    data,
    redirectTo: `${await siteOrigin()}/auth/callback?next=${encodeURIComponent("/welcome")}`,
  });
  if (res?.user) return { userId: res.user.id, reused: false };
  if (error && /already|registered|exists/i.test(error.message)) {
    const userId = await findAuthUserId(admin, email);
    return userId ? { userId, reused: true } : { error: "Could not find the existing sign-in account for that email." };
  }
  // The sign-in account may have been created before sending failed; remove it so a retry starts clean.
  const orphan = await findAuthUserId(admin, email);
  if (orphan) await admin.auth.admin.deleteUser(orphan);
  const msg = error?.message ?? "Could not send the invitation.";
  if (/rate|limit|too many/i.test(msg)) return { error: "Email limit reached", rateLimited: true };
  return { error: /sending|smtp|email/i.test(msg) ? "The invitation email could not be sent (check SMTP settings)" : msg };
}
