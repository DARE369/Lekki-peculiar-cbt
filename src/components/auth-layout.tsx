import Link from "next/link";
import { Logo } from "@/components/brand";
import { ThemeSwitcher } from "@/components/theme";
import { brand } from "@/lib/brand";

/** Split layout for sign-in / setup pages: brand story on the left, the form on the right. */
export function AuthLayout({ children, title, subtitle }: { children: React.ReactNode; title: string; subtitle?: string }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
      <aside className="relative hidden overflow-hidden border-r-4 border-[var(--gold)] bg-[var(--panel-1)] p-12 text-white lg:flex lg:flex-col">
        <Link href="/" className="relative">
          <Logo inverted />
        </Link>
        <div className="relative mt-auto max-w-md">
          {/* The full logo on a white card, so its red and navy lettering stays legible on the dark panel. */}
          <div className="w-fit rounded-lg bg-white p-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={brand.fullLogoSrc} alt={brand.schoolName} width={220} height={189} className="h-auto w-[220px]" />
          </div>
          <h2 className="mt-8 text-3xl leading-tight font-semibold">{brand.schoolName}</h2>
          <p className="mt-3 text-base leading-relaxed text-white/80">{brand.vision}</p>
          <p className="mt-6 text-sm text-white/70">{brand.coreValues.join(" · ")}</p>
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
            <h1 className="text-2xl font-semibold">{title}</h1>
            {subtitle ? <p className="mt-1.5 text-muted">{subtitle}</p> : null}
            <div className="mt-6">{children}</div>
          </div>
        </div>
      </main>
    </div>
  );
}
