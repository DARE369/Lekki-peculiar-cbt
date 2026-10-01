import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import { Logo } from "@/components/brand";
import { ThemeSwitcher } from "@/components/theme";
import { brand } from "@/lib/brand";

/** Split layout for sign-in / setup pages: brand story on the left, the form on the right. */
export function AuthLayout({ children, title, subtitle }: { children: React.ReactNode; title: string; subtitle?: string }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
      <aside className="relative hidden overflow-hidden bg-[linear-gradient(145deg,var(--panel-1),var(--panel-2)_45%,var(--panel-3))] p-12 text-white lg:flex lg:flex-col">
        <div className="bg-grid pointer-events-none absolute inset-0 opacity-[0.12]" aria-hidden />
        <div className="pointer-events-none absolute -right-24 -bottom-24 size-[420px] rounded-full bg-[var(--gold)]/20 blur-3xl" aria-hidden />
        <Link href="/" className="relative">
          <Logo inverted />
        </Link>
        <div className="relative mt-auto max-w-md">
          {/* The full logo on a white card, so its red and navy lettering stays legible on the dark panel. */}
          <div className="w-fit rounded-3xl bg-white p-5 shadow-lg">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={brand.fullLogoSrc} alt={brand.schoolName} width={220} height={189} className="h-auto w-[220px]" />
          </div>
          <h2 className="mt-8 text-4xl leading-tight font-bold tracking-tight">{brand.schoolName}</h2>
          <p className="mt-4 text-lg leading-relaxed text-white/80">{brand.vision}</p>
          <ul className="mt-8 flex flex-wrap gap-2">
            {brand.coreValues.map((v) => (
              <li key={v} className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-sm font-medium ring-1 ring-white/20">
                <CheckCircle2 className="size-3.5 text-[var(--gold)]" aria-hidden />
                {v}
              </li>
            ))}
          </ul>
        </div>
        <p className="relative mt-12 text-xs text-white/60">© {new Date().getFullYear()} {brand.schoolName}</p>
      </aside>

      <main className="relative flex flex-col bg-hero">
        <div className="flex items-center justify-between p-5 sm:p-8">
          <Link href="/" className="lg:invisible">
            <Logo />
          </Link>
          <ThemeSwitcher compact />
        </div>
        <div className="flex flex-1 items-center justify-center px-5 pb-16 sm:px-8">
          <div className="w-full max-w-[420px]">
            <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
            {subtitle ? <p className="mt-2 text-muted">{subtitle}</p> : null}
            <div className="mt-8">{children}</div>
          </div>
        </div>
      </main>
    </div>
  );
}
