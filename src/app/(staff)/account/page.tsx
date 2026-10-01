import type { Metadata } from "next";
import { UserRound } from "lucide-react";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Alert, Badge, Card, CardHeader, Field, Input, PageHeader } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { getStructure } from "@/lib/data";
import { PERMISSIONS } from "@/lib/types";
import { changePassword, updatePhone } from "./actions";

export const metadata: Metadata = { title: "My account" };

export default async function AccountPage(props: PageProps<"/account">) {
  const staff = await requireStaff();
  const { welcome } = await props.searchParams;
  const s = await getStructure();
  return (
    <div className="max-w-2xl space-y-6">
      <PageHeader
        icon={UserRound} title="My account" description={staff.email} />
      {welcome ? (
        <Alert tone="success" title={`Welcome, ${staff.fullName}!`}>
          Your account is ready. Set a password below so you can sign in next time — or skip it and use Continue with Google on the
          sign-in page if the school has switched that on. Then open the menu to get started.
        </Alert>
      ) : null}
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
        <CardHeader title="Phone number" description="So the school can reach you about questions and exams." />
        <ActionForm action={updatePhone} className="flex flex-wrap items-end gap-3 p-5">
          <Field label="Phone" className="min-w-56 flex-1">
            <Input name="phone" type="tel" inputMode="tel" defaultValue={staff.phone ?? ""} placeholder="0803 123 4567" required />
          </Field>
          <SubmitButton variant="secondary">Save</SubmitButton>
        </ActionForm>
      </Card>
      <Card>
        <CardHeader title="Change password" />
        <ActionForm action={changePassword} className="space-y-4 p-5" resetOnSuccess>
          <Field label="New password">
            <Input name="password" type="password" minLength={8} required autoComplete="new-password" />
          </Field>
          <Field label="Confirm new password">
            <Input name="confirm" type="password" minLength={8} required autoComplete="new-password" />
          </Field>
          <SubmitButton>Update password</SubmitButton>
        </ActionForm>
      </Card>
    </div>
  );
}
