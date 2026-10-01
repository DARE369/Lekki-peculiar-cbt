import type { Metadata } from "next";
import { UserCog } from "lucide-react";
import { notFound } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Card, CardHeader, Checkbox, Field, Input, PageHeader } from "@/components/ui";
import { requireSuperAdmin } from "@/lib/auth";
import { getStructure } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";
import type { Permission, StaffRole } from "@/lib/types";
import { AccessFields } from "../access-fields";
import { deleteStaff, resetStaffPassword, updateStaffAccess } from "../actions";

export const metadata: Metadata = { title: "Staff member" };

export default async function StaffMemberPage(props: PageProps<"/admin/staff/[id]">) {
  const { id } = await props.params;
  const me = await requireSuperAdmin();
  const s = await getStructure();
  const supabase = await createClient();
  const [{ data: m }, { data: perms }, { data: scopes }] = await Promise.all([
    supabase.from("staff").select("*").eq("id", id).maybeSingle(),
    supabase.from("staff_permissions").select("permission").eq("staff_id", id),
    supabase.from("admin_sections").select("section_id").eq("staff_id", id),
  ]);
  if (!m) notFound();
  return (
    <div className="max-w-2xl space-y-6">
      <PageHeader
        icon={UserCog} title={m.full_name} description={m.email} back={{ href: "/admin/staff", label: "Staff" }} />
      <Card>
        <CardHeader title="Access" />
        <ActionForm action={updateStaffAccess} className="space-y-4 p-5">
          <input type="hidden" name="id" value={m.id} />
          <Field label="Full name">
            <Input name="full_name" defaultValue={m.full_name} required />
          </Field>
          <AccessFields
            sections={s.sections}
            role={m.role as StaffRole}
            sectionIds={(scopes ?? []).map((x) => x.section_id)}
            permissions={(perms ?? []).map((p) => p.permission as Permission)}
          />
          <Checkbox name="active" label="Active (can sign in)" defaultChecked={m.active} />
          <SubmitButton>Save</SubmitButton>
        </ActionForm>
      </Card>
      <Card>
        <CardHeader title="Password" description="If they're locked out, generate a new temporary password." />
        <ActionForm action={resetStaffPassword} className="p-5">
          <input type="hidden" name="id" value={m.id} />
          <SubmitButton variant="secondary" confirm="Replace their password with a new temporary one?">
            Reset password
          </SubmitButton>
        </ActionForm>
      </Card>
      {m.id !== me.id ? (
        <Card className="border-danger/40">
          <CardHeader
            title="Delete staff member"
            description="Removes them and their sign-in completely. Only possible for people who haven't written any questions or tests — for everyone else, untick Active above, which blocks sign-in but keeps their work in the reports."
          />
          <ActionForm action={deleteStaff} className="p-5">
            <input type="hidden" name="id" value={m.id} />
            <SubmitButton variant="danger" confirm={`Permanently delete ${m.full_name}? This can't be undone.`}>
              Delete {m.full_name}
            </SubmitButton>
          </ActionForm>
        </Card>
      ) : null}
    </div>
  );
}
