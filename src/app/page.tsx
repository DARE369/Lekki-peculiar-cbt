import Link from "next/link";
import { Logo } from "@/components/brand";
import { Alert } from "@/components/ui";
import { isConfigured } from "@/lib/env";

export const dynamic = "force-dynamic";

export default function Home() {
  const configured = isConfigured();
  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col px-4 py-10">
      <Logo />
      <div className="my-auto py-12">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Welcome</h1>
        <p className="mt-2 text-muted">Choose how you are using this computer.</p>
        {!configured ? (
          <div className="mt-6">
            <Alert tone="warning" title="Not configured yet">
              Supabase environment variables are missing. Follow docs/DEPLOYMENT.md to finish setup.
            </Alert>
          </div>
        ) : null}
        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          <Link
            href="/exam"
            className="group rounded-2xl border border-border bg-surface p-6 transition hover:border-brand hover:shadow-sm"
          >
            <p className="text-sm font-medium text-accent">Students</p>
            <p className="mt-1 text-xl font-semibold">Take an exam</p>
            <p className="mt-2 text-sm text-muted">For registered lab computers. Log in with your admission number or your name.</p>
            <p className="mt-4 text-sm font-medium text-brand group-hover:underline">Open exam screen →</p>
          </Link>
          <Link
            href="/login"
            className="group rounded-2xl border border-border bg-surface p-6 transition hover:border-brand hover:shadow-sm"
          >
            <p className="text-sm font-medium text-accent">Teachers &amp; administrators</p>
            <p className="mt-1 text-xl font-semibold">Staff sign in</p>
            <p className="mt-2 text-sm text-muted">Set questions, approve and run exams, and view reports.</p>
            <p className="mt-4 text-sm font-medium text-brand group-hover:underline">Sign in →</p>
          </Link>
        </div>
      </div>
      <p className="text-xs text-muted">© Lekki Peculiar School</p>
    </main>
  );
}
