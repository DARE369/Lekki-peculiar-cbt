import type { Metadata } from "next";
import { Mail, UserCog, Users } from "lucide-react";
import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Alert, Badge, Card, CardHeader, Field, Input, LinkButton, PageHeader, Select, Table, Td, Th, cn } from "@/components/ui";
import { requireSuperAdmin } from "@/lib/auth";
import { getStructure } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";
import { PERMISSIONS, type Permission } from "@/lib/types";
import { AccessFields } from "./access-fields";
import { assignSection, createStaff, sendTestEmail } from "./actions";
import { staffSectionMap } from "@/lib/sections";
import { SectionBadges } from "@/components/section-badges";

export const metadata: Metadata = { title: "Staff & permissions" };

const ROLE: Record<string, [string, "brand" | "info" | "neutral"]> = {
  super_admin: ["Super admin", "brand"],
  admin: ["Head of Section", "info"],
  teacher: ["Teacher", "neutral"],
};

export default async function StaffPage(props: PageProps<"/admin/staff">) {
  await requireSuperAdmin();
  const { deleted, section: sectionFilter } = await props.searchParams;
  const s = await getStructure();
  const supabase = await createClient();
  const [{ data: allStaff }, { data: perms }, { data: scopes }, sectionsOf] = await Promise.all([
    supabase.from("staff").select("id, full_name, email, role, active").order("full_name"),
    supabase.from("staff_permissions").select("staff_id, permission"),
    supabase.from("admin_sections").select("staff_id, section_id"),
    staffSectionMap(),
  ]);
  const cbtSections = s.sections.filter((x) => x.cbt_enabled);
  const filter = typeof sectionFilter === "string" ? sectionFilter : "";
  const staff = (allStaff ?? []).filter((m) =>
    !filter ? true : filter === "none" ? m.role === "teacher" && !(sectionsOf.get(m.id)?.length) : (sectionsOf.get(m.id) ?? []).includes(filter),
  );
  const unassigned = (allStaff ?? []).filter((m) => m.role === "teacher" && m.active && !(sectionsOf.get(m.id)?.length)).length;
  const permsBy = new Map<string, Permission[]>();
  for (const p of perms ?? []) permsBy.set(p.staff_id, [...(permsBy.get(p.staff_id) ?? []), p.permission as Permission]);
  const scopesBy = new Map<string, string[]>();
  for (const x of scopes ?? []) scopesBy.set(x.staff_id, [...(scopesBy.get(x.staff_id) ?? []), x.section_id]);

  return (
    <div className="space-y-6">
      <PageHeader
        icon={UserCog}
        title="Staff & permissions"
        description="Add staff, put each teacher in a section, and press Edit on anyone to change their role, section or permissions at any time."
        actions={
          <LinkButton href="/admin/staff/import" variant="secondary">
            <Users /> Bulk add staff
          </LinkButton>
        }
      />
      {typeof deleted === "string" ? <Alert tone="success">{deleted} was deleted.</Alert> : null}
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Filter by section">
        {[
          ["", "Everyone"],
          ...cbtSections.map((x) => [x.id, x.name]),
          ...(unassigned ? [["none", `No section yet (${unassigned})`]] : []),
        ].map(([key, label]) => (
          <Link
            key={key}
            href={key ? `/admin/staff?section=${key}` : "/admin/staff"}
            role="tab"
            aria-selected={filter === key}
            className={cn(
              "rounded-full border px-3.5 py-1.5 text-sm font-semibold",
              filter === key ? "border-brand bg-brand text-white" : "border-border hover:border-brand",
            )}
          >
            {label}
          </Link>
        ))}
      </div>
      <Card>
        <Table stack>
          <thead>
            <tr>
              <Th>Name</Th>
              <Th>Role</Th>
              <Th>Section</Th>
              <Th>Permissions</Th>
              <Th className="w-24" />
            </tr>
          </thead>
          <tbody>
            {staff.length === 0 ? (
              <tr>
                <Td colSpan={5} className="py-8 text-center text-muted">
                  Nobody here yet.
                </Td>
              </tr>
            ) : null}
            {staff.map((m) => {
              const [label, tone] = ROLE[m.role];
              const secs = sectionsOf.get(m.id) ?? [];
              return (
                <tr key={m.id} className={m.active ? "" : "opacity-60"}>
                  <Td>
                    <Link href={`/admin/staff/${m.id}`} className="text-brand font-medium hover:underline">
                      {m.full_name}
                    </Link>
                    <span className="block text-xs text-muted">{m.email}</span>
                  </Td>
                  <Td label="Role">
                    <Badge tone={tone}>{label}</Badge> {!m.active ? <Badge tone="danger">Inactive</Badge> : null}
                  </Td>
                  <Td label="Section">
                    {m.role === "teacher" && secs.length === 0 ? (
                      <form action={assignSection} className="flex items-center gap-2">
                        <input type="hidden" name="id" value={m.id} />
                        <Select name="section_id" defaultValue="" aria-label={`Section for ${m.full_name}`} className="h-9 w-36 text-sm">
                          <option value="">Choose…</option>
                          {cbtSections.map((x) => (
                            <option key={x.id} value={x.id}>
                              {x.name}
                            </option>
                          ))}
                        </Select>
                        <SubmitButton size="sm" variant="secondary" pendingText="…">
                          Save
                        </SubmitButton>
                      </form>
                    ) : m.role === "super_admin" ? (
                      <span className="text-xs text-muted">All sections</span>
                    ) : (
                      <SectionBadges ids={secs} s={s} />
                    )}
                  </Td>
                  <Td label="Can do" className="text-xs text-muted">
                    {m.role === "super_admin" ? "Everything" : (permsBy.get(m.id) ?? []).map((p) => PERMISSIONS[p]).join(" · ") || "—"}
                  </Td>
                  <Td className="cell-actions">
                    <Link href={`/admin/staff/${m.id}`} className="inline-flex h-9 items-center rounded-lg border border-border px-3 text-sm font-semibold text-brand hover:border-brand" aria-label={`Edit ${m.full_name}`}>
                      Edit
                    </Link>
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
            <Select name="method" defaultValue="invite">
              <option value="invite">Email them an invitation link</option>
              <option value="password">Show me a temporary password to give them</option>
            </Select>
          </Field>
          <SubmitButton>Add staff member</SubmitButton>
        </ActionForm>
      </Card>
    </div>
  );
}
