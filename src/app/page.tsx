import Link from "next/link";
import { ChevronRight, GraduationCap, KeyRound } from "lucide-react";
import { Logo } from "@/components/brand";
import { ThemeSwitcher } from "@/components/theme";
import { Alert } from "@/components/ui";
import { brand } from "@/lib/brand";
import { isConfigured } from "@/lib/env";

export const dynamic = "force-dynamic";

/** The first screen on a lab computer: one question — are you a student or staff? */
export default function Home() {
  const configured = isConfigured();
  return (
    <div className="flex min-h-screen flex-col bg-bg">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-5 py-3 sm:px-8">
          <Logo />
          <ThemeSwitcher compact />
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-5 py-10 sm:px-8 sm:py-16">
        <p className="text-sm text-muted">{brand.schoolName}</p>
        <h1 className="mt-1 text-3xl font-semibold sm:text-4xl">{brand.productName}</h1>
        <p className="mt-3 max-w-xl text-muted">Tests and exams for Elementary and College, taken on the school&apos;s computers.</p>

        {!configured ? (
          <div className="mt-6">
            <Alert tone="warning" title="Not configured yet">
              Supabase environment variables are missing. Follow docs/DEPLOYMENT.md to finish setup.
            </Alert>
          </div>
        ) : null}

        <h2 className="mt-10 text-sm font-medium text-muted">How are you using this computer?</h2>
        <ul className="mt-3 divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface">
          <li>
            <Link href="/exam" className="group flex items-center gap-4 px-5 py-5 hover:bg-surface-2 focus-visible:bg-surface-2 sm:px-6">
              <GraduationCap className="size-6 shrink-0 text-brand" aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block text-lg font-semibold">I&apos;m a student — take an exam</span>
                <span className="mt-0.5 block text-sm text-muted">Type your admission number, or find your name and picture.</span>
              </span>
              <ChevronRight className="size-5 shrink-0 text-subtle group-hover:text-text" aria-hidden />
            </Link>
          </li>
          <li>
            <Link href="/login" className="group flex items-center gap-4 px-5 py-5 hover:bg-surface-2 focus-visible:bg-surface-2 sm:px-6">
              <KeyRound className="size-6 shrink-0 text-muted" aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block text-lg font-semibold">I&apos;m staff — sign in</span>
                <span className="mt-0.5 block text-sm text-muted">Set questions, approve and run exams, and see results.</span>
              </span>
              <ChevronRight className="size-5 shrink-0 text-subtle group-hover:text-text" aria-hidden />
            </Link>
          </li>
        </ul>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto max-w-3xl px-5 py-5 text-xs text-muted sm:px-8">{brand.coreValues.join(" · ")}</div>
      </footer>
    </div>
  );
}
