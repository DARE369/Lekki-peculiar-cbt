import type { Metadata } from "next";
import { AuthLayout } from "@/components/auth-layout";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Alert, Field, Input } from "@/components/ui";
import { createAdminClient } from "@/lib/supabase/server";
import { isConfigured } from "@/lib/env";
import { setupSuperAdmin } from "./actions";

export const metadata: Metadata = { title: "First-time setup" };
export const dynamic = "force-dynamic";

export default async function SetupPage() {
  let done = false;
  let problem: string | null = null;
  if (!isConfigured()) {
    problem = "Supabase environment variables are missing.";
  } else {
    try {
      const { count, error } = await createAdminClient().from("staff").select("id", { count: "exact", head: true });
      if (error) problem = `Database not ready: ${error.message}`;
      done = (count ?? 0) > 0;
    } catch (e) {
      problem = (e as Error).message;
    }
  }

  return (
    <AuthLayout title="First-time setup" subtitle="Create the super administrator account. This page works only once.">
      {problem ? (
        <Alert tone="danger" title="Can't continue">
          {problem} See docs/DEPLOYMENT.md.
        </Alert>
      ) : done ? (
        <Alert tone="success" title="Setup is complete">
          A super administrator already exists.{" "}
          <a href="/login" className="font-semibold underline">
            Sign in
          </a>
          .
        </Alert>
      ) : (
        <ActionForm action={setupSuperAdmin} className="space-y-4">
          <Field label="Setup code" hint="The SETUP_SECRET value configured on the server.">
            <Input name="secret" type="password" required className="h-11" />
          </Field>
          <Field label="Your full name">
            <Input name="full_name" required className="h-11" />
          </Field>
          <Field label="School email">
            <Input name="email" type="email" required className="h-11" />
          </Field>
          <Field label="Password" hint="At least 10 characters.">
            <Input name="password" type="password" minLength={10} required className="h-11" />
          </Field>
          <SubmitButton className="w-full" size="lg">
            Create super administrator
          </SubmitButton>
        </ActionForm>
      )}
    </AuthLayout>
  );
}
