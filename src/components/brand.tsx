import { cn } from "@/components/ui";

/** School mark. Replace with the real logo files in /public when the school provides them. */
export function Logo({ className, compact = false }: { className?: string; compact?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <svg viewBox="0 0 40 40" className="h-9 w-9 shrink-0" aria-hidden>
        <rect width="40" height="40" rx="10" fill="var(--brand)" />
        <path d="M11 12h5v13h9v4H11z" fill="#fff" />
        <circle cx="28" cy="14" r="4" fill="var(--accent)" />
      </svg>
      {compact ? null : (
        <span className="leading-tight">
          <span className="block text-sm font-semibold">Lekki Peculiar</span>
          <span className="block text-xs text-muted">Computer-Based Testing</span>
        </span>
      )}
    </span>
  );
}
