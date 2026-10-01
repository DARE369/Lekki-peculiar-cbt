import type { Metadata } from "next";
import { Mail, UserCog } from "lucide-react";
import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Badge, Card, CardHeader, Field, Input, PageHeader, Select, Table, Td, Th } from "@/components/ui";
import { requireSuperAdmin } from "@/lib/auth";
import { getStructure } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";
import { PERMISSIONS, type Permission } from "@/lib/types";
import { AccessFields } from "./access-fields";
import { createStaff, sendTestEmail } from "./actions";

export const metadata: Metadata = { title: "Staff & permissions" };

const ROLE: Record<string, [string, "brand" | "info" | "neutral"]> = {
  super_admin: ["Super admin", "brand"],
  admin: ["Head of Section", "info"],
  teacher: ["Teacher", "neutral"],
};

export default async function StaffPage() {
  await requireSuperAdmin();
  const s = await getStructure();
  const supabase = await createClient();
  const [{ data: staff }, { data: perms }, { data: scopes }] = await Promise.all([
    supabase.from("staff").select("id, full_name, email, role, active").order("full_name"),
    supabase.from("staff_permissions").select("staff_id, permission"),
    supabase.from("admin_sections").select("staff_id, section_id"),
  ]);
  const permsBy = new Map<string, Permission[]>();
  for (const p of perms ?? []) permsBy.set(p.staff_id, [...(permsBy.get(p.staff_id) ?? []), p.permission as Permission]);
  const scopesBy = new Map<string, string[]>();
  for (const x of scopes ?? []) scopesBy.set(x.staff_id, [...(scopesBy.get(x.staff_id) ?? []), x.section_id]);

  return (
    <div className="space-y-6">
      <PageHeader
        icon={UserCog} title="Staff & permissions" description="Add teachers and Heads of Section, and decide exactly what each admin may do." />
      <Card>
        <Table>
          <thead>
            <tr>
              <Th>Name</Th>
              <Th>Role</Th>
              <Th>Sections</Th>
              <Th>Permissions</Th>
            </tr>
          </thead>
          <tbody>
            {(staff ?? []).map((m) => {
              const [label, tone] = ROLE[m.role];
              return (
                <tr key={m.id} className={m.active ? "" : "opacity-60"}>
                  <Td>
                    <Link href={`/admin/staff/${m.id}`} className="font-medium hover:underline">
                      {m.full_name}
                    </Link>
                    <span className="block text-xs text-muted">{m.email}</span>
                  </Td>
                  <Td>
                    <Badge tone={tone}>{label}</Badge> {!m.active ? <Badge tone="danger">Inactive</Badge> : null}
                  </Td>
                  <Td className="text-xs">{(scopesBy.get(m.id) ?? []).map((id) => s.sectionById.get(id)?.name).join(", ") || "—"}</Td>
                  <Td className="text-xs text-muted">
                    {m.role === "super_admin" ? "All" : (permsBy.get(m.id) ?? []).map((p) => PERMISSIONS[p]).join(" · ") || "—"}
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      </Card>
      <Card>
        <CardHeader
          icon={Mail}
          title="Email delivery"
          description="Invitations, email sign-in links and password resets use the SMTP settings in Supabase. Send yourself a test to check they work."
        />
        <ActionForm action={sendTestEmail} className="p-5">
          <SubmitButton variant="secondary" pendingText="Sending…">
            Send me a test email
          </SubmitButton>
        </ActionForm>
      </Card>
      <Card>
        <CardHeader title="Add a staff member" />
        <ActionForm action={createStaff} className="space-y-4 p-5" resetOnSuccess>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Full name">
              <Input name="full_name" required placeholder="Mr Dixon Adebayo" />
            </Field>
            <Field label="School email">
              <Input name="email" type="email" required />
            </Field>
          </div>
          <AccessFields sections={s.sections} />
          <Field label="How should they sign in the first time?">
            <Select name="method" defaultValue="password">
              <option value="password">Show me a temporary password to give them</option>
              <option value="invite">Email them an invitation link</option>
            </Select>
          </Field>
          <SubmitButton>Add staff member</SubmitButton>
        </ActionForm>
      </Card>
    </div>
  );
}
