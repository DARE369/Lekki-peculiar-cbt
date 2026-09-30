import Link from "next/link";
import { ArrowRight, GraduationCap, KeyRound, LayoutDashboard, MonitorCheck, ShieldCheck, WifiOff } from "lucide-react";
import { Logo } from "@/components/brand";
import { ThemeSwitcher } from "@/components/theme";
import { Alert } from "@/components/ui";
import { brand } from "@/lib/brand";
import { isConfigured } from "@/lib/env";

export const dynamic = "force-dynamic";

const FEATURES = [
  { icon: WifiOff, title: "Works when the internet doesn't", text: "Answers are saved on the lab computer and uploaded when the connection returns." },
  { icon: ShieldCheck, title: "Fair and secure", text: "Exams start only when an administrator says so. Answers lock the moment they're submitted." },
  { icon: LayoutDashboard, title: "Reports that make sense", text: "Every subject, every class, every student — and the exact questions each one missed." },
];

export default function Home() {
  const configured = isConfigured();
  return (
    <div className="bg-hero min-h-screen">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-5 py-5 sm:px-8">
        <Logo />
        <div className="flex items-center gap-3">
          <ThemeSwitcher compact />
          <Link
            href="/login"
            className="hidden rounded-xl px-4 py-2 text-sm font-semibold text-muted hover:bg-surface hover:text-text sm:inline-flex"
          >
            Staff sign in
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-5 pt-10 pb-20 sm:px-8 sm:pt-16">
        <div className="max-w-3xl">
          <p className="inline-flex items-center gap-2 rounded-full border border-border bg-surface/80 px-3 py-1 text-xs font-semibold text-brand shadow-soft backdrop-blur">
            <span className="size-1.5 rounded-full bg-accent" aria-hidden /> {brand.schoolName}
          </p>
          <h1 className="mt-6 text-4xl leading-[1.1] font-extrabold tracking-tight sm:text-6xl">
            Welcome to <span className="bg-gradient-to-r from-brand to-brand-2 bg-clip-text text-transparent">{brand.productName}</span>
          </h1>
          <p className="mt-5 max-w-2xl text-lg leading-relaxed text-muted">
            Tests and exams for Elementary and College, taken on the school&apos;s computers. Choose how you&apos;re using this computer.
          </p>
        </div>

        {!configured ? (
          <div className="mt-8 max-w-3xl">
            <Alert tone="warning" title="Not configured yet">
              Supabase environment variables are missing. Follow docs/DEPLOYMENT.md to finish setup.
            </Alert>
          </div>
        ) : null}

        <div className="mt-12 grid gap-5 md:grid-cols-2">
          <Link
            href="/exam"
            className="group relative overflow-hidden rounded-3xl border border-border bg-surface p-7 shadow-card transition-all hover:-translate-y-0.5 hover:border-brand/40 hover:shadow-float sm:p-9"
          >
            <div className="pointer-events-none absolute -top-16 -right-16 size-48 rounded-full bg-brand-soft blur-2xl transition-opacity group-hover:opacity-100" aria-hidden />
            <span className="relative inline-flex size-14 items-center justify-center rounded-2xl bg-brand text-brand-ink shadow-card">
              <GraduationCap className="size-7" aria-hidden />
            </span>
            <p className="relative mt-6 text-sm font-semibold tracking-wide text-brand uppercase">Students</p>
            <p className="relative mt-1 text-2xl font-bold tracking-tight">Take an exam</p>
            <p className="relative mt-3 leading-relaxed text-muted">
              On a lab computer. Type your admission number, or find your name and picture.
            </p>
            <span className="relative mt-8 inline-flex items-center gap-2 font-semibold text-brand">
              Open the exam screen <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" aria-hidden />
            </span>
          </Link>

          <Link
            href="/login"
            className="group relative overflow-hidden rounded-3xl border border-border bg-surface p-7 shadow-card transition-all hover:-translate-y-0.5 hover:border-brand/40 hover:shadow-float sm:p-9"
          >
            <div className="pointer-events-none absolute -top-16 -right-16 size-48 rounded-full bg-accent-soft blur-2xl" aria-hidden />
            <span className="relative inline-flex size-14 items-center justify-center rounded-2xl bg-accent text-accent-ink shadow-card">
              <KeyRound className="size-7" aria-hidden />
            </span>
            <p className="relative mt-6 text-sm font-semibold tracking-wide text-[color:var(--warning)] uppercase dark:text-accent">
              Teachers &amp; administrators
            </p>
            <p className="relative mt-1 text-2xl font-bold tracking-tight">Staff sign in</p>
            <p className="relative mt-3 leading-relaxed text-muted">Set questions, approve and run exams, and see every result organised.</p>
            <span className="relative mt-8 inline-flex items-center gap-2 font-semibold text-brand">
              Sign in <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" aria-hidden />
            </span>
          </Link>
        </div>

        <div className="mt-16 grid gap-6 sm:grid-cols-3">
          {FEATURES.map(({ icon: Icon, title, text }) => (
            <div key={title} className="flex gap-4">
              <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl bg-surface text-brand shadow-soft ring-1 ring-border">
                <Icon className="size-5" aria-hidden />
              </span>
              <div>
                <p className="font-semibold">{title}</p>
                <p className="mt-1 text-sm leading-relaxed text-muted">{text}</p>
              </div>
            </div>
          ))}
        </div>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-5 py-6 text-xs text-muted sm:px-8">
          <span className="inline-flex items-center gap-2">
            <MonitorCheck className="size-4" aria-hidden /> {brand.schoolName}
          </span>
          <span>{brand.coreValues.join(" · ")}</span>
        </div>
      </footer>
    </div>
  );
}
