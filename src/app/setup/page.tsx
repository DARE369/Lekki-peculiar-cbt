import type { Metadata } from "next";
import { Logo } from "@/components/brand";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Alert, Card, Field, Input } from "@/components/ui";
import { createAdminClient } from "@/lib/supabase/server";
import { isConfigured } from "@/lib/env";
import { setupSuperAdmin } from "./actions";

export const metadata: Metadata = { title: "First-time setup" };

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
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <Logo className="mb-8" />
        <Card className="p-6">
          <h1 className="text-xl font-semibold">First-time setup</h1>
          <p className="mt-1 mb-6 text-sm text-muted">Create the super administrator account. This page works only once.</p>
          {problem ? (
            <Alert tone="danger" title="Can't continue">{problem} See docs/DEPLOYMENT.md.</Alert>
          ) : done ? (
            <Alert tone="success" title="Setup is complete">
              A super administrator already exists. <a href="/login" className="underline">Sign in</a>.
            </Alert>
          ) : (
            <ActionForm action={setupSuperAdmin} className="space-y-4">
              <Field label="Setup code" hint="The SETUP_SECRET value configured on the server.">
                <Input name="secret" type="password" required />
              </Field>
              <Field label="Your full name">
                <Input name="full_name" required />
              </Field>
              <Field label="School email">
                <Input name="email" type="email" required />
              </Field>
              <Field label="Password" hint="At least 10 characters.">
                <Input name="password" type="password" minLength={10} required />
              </Field>
              <SubmitButton className="w-full">Create super administrator</SubmitButton>
            </ActionForm>
          )}
        </Card>
      </div>
    </main>
  );
}
