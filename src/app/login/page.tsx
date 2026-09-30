import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthLayout } from "@/components/auth-layout";
import { Alert } from "@/components/ui";
import { getStaff } from "@/lib/auth";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Staff sign in" };

export default async function LoginPage(props: PageProps<"/login">) {
  const { next, error } = await props.searchParams;
  if (await getStaff()) redirect("/dashboard");
  return (
    <AuthLayout title="Welcome back" subtitle="Sign in with your official school email.">
      {error === "link" ? (
        <div className="mb-6">
          <Alert tone="warning">That sign-in link has expired or was already used. Request a new one below.</Alert>
        </div>
      ) : null}
      <LoginForm next={typeof next === "string" ? next : "/dashboard"} />
      <p className="mt-10 rounded-2xl border border-dashed border-border p-4 text-center text-sm text-muted">
        Students don&apos;t sign in here — use the{" "}
        <Link href="/exam" className="font-semibold text-brand hover:underline">
          exam screen
        </Link>{" "}
        on a lab computer.
      </p>
    </AuthLayout>
  );
}
