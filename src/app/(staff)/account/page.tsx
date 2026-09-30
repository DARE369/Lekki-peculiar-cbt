import type { Metadata } from "next";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Badge, Card, CardHeader, Field, Input, PageHeader } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { getStructure } from "@/lib/data";
import { PERMISSIONS } from "@/lib/types";
import { changePassword } from "./actions";

export const metadata: Metadata = { title: "My account" };

export default async function AccountPage() {
  const staff = await requireStaff();
  const s = await getStructure();
  return (
    <div className="max-w-2xl space-y-6">
      <PageHeader title="My account" description={staff.email} />
      <Card>
        <CardHeader title="Access" />
        <div className="space-y-3 p-5 text-sm">
          <p>
            Role: <strong>{staff.isSuperAdmin ? "Super admin" : staff.role === "admin" ? "Head of Section" : "Teacher"}</strong>
          </p>
          {staff.sectionIds.length ? (
            <p>Sections: {staff.sectionIds.map((id) => s.sectionById.get(id)?.name).join(", ")}</p>
          ) : null}
          {staff.permissions.size ? (
            <div className="flex flex-wrap gap-1.5">
              {[...staff.permissions].map((p) => (
                <Badge key={p} tone="brand">
                  {PERMISSIONS[p]}
                </Badge>
              ))}
            </div>
          ) : null}
        </div>
      </Card>
      <Card>
        <CardHeader title="Change password" />
        <ActionForm action={changePassword} className="space-y-4 p-5" resetOnSuccess>
          <Field label="New password">
            <Input name="password" type="password" minLength={10} required autoComplete="new-password" />
          </Field>
          <Field label="Confirm new password">
            <Input name="confirm" type="password" minLength={10} required autoComplete="new-password" />
          </Field>
          <SubmitButton>Update password</SubmitButton>
        </ActionForm>
      </Card>
    </div>
  );
}
