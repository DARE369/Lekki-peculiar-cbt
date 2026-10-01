import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthLayout } from "@/components/auth-layout";
import { Alert } from "@/components/ui";
import { getStaff } from "@/lib/auth";
import { googleSignInEnabled } from "@/lib/auth-settings";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Staff sign in" };

const ERRORS: Record<string, string> = {
  link: "That sign-in link has expired or was already used. Request a new one below.",
  google: "Google sign-in didn't complete. Please try again, or sign in with your password.",
  "not-staff":
    "That Google account isn't on the staff list. Choose your official school account, or ask the school administrator to add your email under Staff & permissions.",
  inactive: "Your staff account has been switched off. Ask the school administrator.",
};

export default async function LoginPage(props: PageProps<"/login">) {
  const { next, error } = await props.searchParams;
  if (await getStaff()) redirect("/dashboard");
  const google = await googleSignInEnabled();
  const message = error ? ERRORS[String(error)] : null;
  return (
    <AuthLayout title="Welcome back" subtitle="Sign in with your official school email.">
      {message ? (
        <div className="mb-6">
          <Alert tone="warning">{message}</Alert>
        </div>
      ) : null}
      <LoginForm next={typeof next === "string" ? next : "/dashboard"} google={google} />
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
