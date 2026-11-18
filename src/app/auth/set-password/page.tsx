import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthLayout } from "@/components/auth-layout";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Field, Input } from "@/components/ui";
import { getStaff } from "@/lib/auth";
import { setPassword } from "./actions";

export const metadata: Metadata = { title: "Set new password" };

export default async function SetPasswordPage() {
  const staff = await getStaff();
  if (!staff) redirect("/login");
  return (
    <AuthLayout title="Choose a new password" subtitle={`You're signed in from the reset link. Set your new password below and you'll be taken straight to your dashboard.`}>
      <ActionForm action={setPassword} className="space-y-5">
        {/* Lets the browser's password manager save the new password with the right email. */}
        <input type="email" name="username" defaultValue={staff.email} autoComplete="username" readOnly hidden />
        <Field label="New password">
          <Input name="password" type="password" minLength={8} required autoComplete="new-password" className="h-12 text-base" />
        </Field>
        <Field label="Confirm new password">
          <Input name="confirm" type="password" minLength={8} required autoComplete="new-password" className="h-12 text-base" />
        </Field>
        <SubmitButton size="lg" className="w-full">
          Update password
        </SubmitButton>
      </ActionForm>
    </AuthLayout>
  );
}
