import { brand } from "@/lib/brand";
import { cn } from "@/components/ui";

/** School mark: the crest if one is configured, otherwise a monogram in the brand colours. */
export function Crest({ size = 40, className }: { size?: number; className?: string }) {
  if (brand.logoSrc) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={brand.logoSrc} alt="" width={size} height={size} className={cn("shrink-0 object-contain", className)} />;
  }
  return (
    <svg viewBox="0 0 48 48" width={size} height={size} className={cn("shrink-0", className)} aria-hidden>
      <defs>
        <linearGradient id="lp-crest" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--brand-2)" />
          <stop offset="1" stopColor="var(--brand)" />
        </linearGradient>
      </defs>
      <path d="M24 3 42 9v14c0 11.5-7.6 19.4-18 22-10.4-2.6-18-10.5-18-22V9z" fill="url(#lp-crest)" />
      <path d="M24 3 42 9v14c0 11.5-7.6 19.4-18 22" fill="none" stroke="var(--accent)" strokeWidth="1.5" opacity=".9" />
      <path d="M16 14h4.5v15H30v4H16z" fill="#fff" />
      <path d="M30.5 13.5a4 4 0 1 1 0 8 4 4 0 0 1 0-8z" fill="var(--accent)" />
    </svg>
  );
}

export function Logo({ className, compact = false, inverted = false }: { className?: string; compact?: boolean; inverted?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-3", className)}>
      <Crest size={40} />
      {compact ? null : (
        <span className="leading-tight">
          <span className={cn("block text-[15px] font-bold tracking-tight", inverted ? "text-white" : "text-text")}>{brand.shortName}</span>
          <span className={cn("block text-xs font-medium", inverted ? "text-white/70" : "text-muted")}>Computer-Based Testing</span>
        </span>
      )}
    </span>
  );
}
