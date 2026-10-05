import Link from "next/link";
import clsx from "clsx";
import { AlertTriangle, CheckCircle2, Inbox, Info, OctagonAlert, type LucideIcon } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";

export const cn = clsx;

// ---------------------------------------------------------------------------
// Buttons
// ---------------------------------------------------------------------------
type Variant = "primary" | "secondary" | "ghost" | "danger" | "accent" | "soft";
const variants: Record<Variant, string> = {
  primary: "bg-brand text-brand-ink shadow-soft hover:bg-brand-hover",
  secondary: "border border-border bg-surface text-text shadow-soft hover:border-border-strong hover:bg-surface-2",
  ghost: "text-muted hover:bg-surface-2 hover:text-text",
  danger: "bg-danger text-white shadow-soft hover:brightness-110 dark:text-bg",
  accent: "bg-accent text-accent-ink shadow-soft hover:brightness-105",
  soft: "bg-brand-soft text-brand hover:bg-brand-soft/70",
};
const sizes = {
  sm: "h-8 gap-1.5 rounded-lg px-3 text-[13px]",
  md: "h-10 gap-2 rounded-xl px-4 text-sm",
  lg: "h-12 gap-2.5 rounded-xl px-6 text-base",
};

export function buttonClass(variant: Variant = "primary", size: keyof typeof sizes = "md", extra?: string) {
  return cn(
    "inline-flex shrink-0 items-center justify-center font-semibold whitespace-nowrap transition-all duration-150",
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand active:scale-[0.98]",
    "disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0",
    variants[variant],
    sizes[size],
    extra,
  );
}

export function Button({
  variant = "primary",
  size = "md",
  className,
  ...props
}: ComponentProps<"button"> & { variant?: Variant; size?: keyof typeof sizes }) {
  return <button className={buttonClass(variant, size, className)} {...props} />;
}

export function LinkButton({
  variant = "primary",
  size = "md",
  className,
  ...props
}: ComponentProps<typeof Link> & { variant?: Variant; size?: keyof typeof sizes }) {
  return <Link className={buttonClass(variant, size, className)} {...props} />;
}

// ---------------------------------------------------------------------------
// Form controls
// ---------------------------------------------------------------------------
const fieldBase =
  "w-full rounded-xl border border-border bg-surface px-3.5 text-sm text-text shadow-soft placeholder:text-subtle " +
  "transition-colors hover:border-border-strong focus:border-brand focus:outline-none focus:ring-4 focus:ring-[var(--ring)] " +
  "disabled:cursor-not-allowed disabled:opacity-60";

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input className={cn(fieldBase, "h-10", className)} {...props} />;
}
export function Select({ className, ...props }: ComponentProps<"select">) {
  return <select className={cn(fieldBase, "h-10 cursor-pointer pr-8", className)} {...props} />;
}
export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return <textarea className={cn(fieldBase, "py-2.5 leading-relaxed", className)} {...props} />;
}

export function Field({
  label,
  hint,
  children,
  className,
}: {
  label: string;
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cn("block space-y-1.5", className)}>
      <span className="text-[13px] font-semibold text-text">{label}</span>
      {children}
      {hint ? <span className="block text-xs leading-relaxed text-muted">{hint}</span> : null}
    </label>
  );
}

export function Checkbox({ label, hint, ...props }: ComponentProps<"input"> & { label: string; hint?: string }) {
  return (
    <label className="flex cursor-pointer items-start gap-3 text-sm">
      <input type="checkbox" className="mt-0.5 size-4 shrink-0 cursor-pointer rounded accent-[var(--brand)]" {...props} />
      <span>
        <span className="font-medium">{label}</span>
        {hint ? <span className="mt-0.5 block text-xs text-muted">{hint}</span> : null}
      </span>
    </label>
  );
}

// ---------------------------------------------------------------------------
// Surfaces
// ---------------------------------------------------------------------------
export function Card({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("rounded-2xl border border-border bg-surface shadow-card", className)} {...props} />;
}

export function IconBadge({ icon: Icon, tone = "brand", size = "md" }: { icon: LucideIcon; tone?: Tone; size?: "sm" | "md" | "lg" }) {
  const box = { sm: "size-8 rounded-lg [&_svg]:size-4", md: "size-10 rounded-xl [&_svg]:size-5", lg: "size-12 rounded-2xl [&_svg]:size-6" }[size];
  return (
    <span className={cn("inline-flex shrink-0 items-center justify-center", box, tones[tone])} aria-hidden>
      <Icon />
    </span>
  );
}

export function CardHeader({
  title,
  description,
  actions,
  icon,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  icon?: LucideIcon;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-4">
      <div className="flex min-w-0 items-start gap-3">
        {icon ? <IconBadge icon={icon} size="sm" /> : null}
        <div className="min-w-0">
          <h2 className="font-semibold tracking-tight">{title}</h2>
          {description ? <p className="mt-0.5 text-sm text-muted">{description}</p> : null}
        </div>
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
  back,
  icon,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  back?: { href: string; label: string };
  icon?: LucideIcon;
}) {
  return (
    <div className="mb-8">
      {back ? (
        <Link
          href={back.href}
          className="no-print mb-3 inline-flex items-center gap-1 rounded-lg px-2 py-1 -ml-2 text-sm font-medium text-muted hover:bg-surface-2 hover:text-text"
        >
          <span aria-hidden>←</span> {back.label}
        </Link>
      ) : null}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex min-w-0 items-start gap-4">
          {icon ? (
            <span className="hidden sm:block">
              <IconBadge icon={icon} size="lg" />
            </span>
          ) : null}
          <div className="min-w-0">
            <h1 className="text-2xl font-bold tracking-tight sm:text-[28px]">{title}</h1>
            {description ? <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-muted">{description}</p> : null}
          </div>
        </div>
        {actions ? <div className="no-print flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------
type Tone = "neutral" | "brand" | "success" | "warning" | "danger" | "info" | "accent";
const tones: Record<Tone, string> = {
  neutral: "bg-surface-2 text-muted",
  brand: "bg-brand-soft text-brand",
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  danger: "bg-danger-soft text-danger",
  info: "bg-info-soft text-info",
  accent: "bg-accent-soft text-[color:var(--warning)] dark:text-accent",
};
export function Badge({ tone = "neutral", children, className, dot }: { tone?: Tone; children: ReactNode; className?: string; dot?: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap",
        tones[tone],
        className,
      )}
    >
      {dot ? <span className="size-1.5 rounded-full bg-current" aria-hidden /> : null}
      {children}
    </span>
  );
}

const alertIcons: Partial<Record<Tone, LucideIcon>> = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  danger: OctagonAlert,
  brand: Info,
};
export function Alert({ tone = "info", title, children }: { tone?: Tone; title?: ReactNode; children?: ReactNode }) {
  const Icon = alertIcons[tone] ?? Info;
  return (
    <div
      className={cn("flex gap-3 rounded-xl border px-4 py-3 text-sm", tones[tone], "border-current/15")}
      role={tone === "danger" ? "alert" : "status"}
    >
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1 leading-relaxed">
        {title ? <p className="font-semibold">{title}</p> : null}
        {children ? <div className={cn(title ? "mt-0.5 opacity-90" : "", "whitespace-pre-line")}>{children}</div> : null}
      </div>
    </div>
  );
}

export function EmptyState({
  title,
  children,
  action,
  icon = Inbox,
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  icon?: LucideIcon;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-14 text-center">
      <span className="mb-2">
        <IconBadge icon={icon} tone="neutral" size="lg" />
      </span>
      <p className="font-semibold">{title}</p>
      {children ? <p className="max-w-md text-sm leading-relaxed text-muted">{children}</p> : null}
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------
/**
 * A data table. With `stack`, rows turn into cards on phones (give each Td a `label`), so nothing
 * scrolls sideways; without it the table scrolls inside its card.
 */
export function Table({ className, stack = false, ...props }: ComponentProps<"table"> & { stack?: boolean }) {
  return (
    <div className={stack ? "md:overflow-x-auto" : "overflow-x-auto"}>
      <table className={cn("w-full border-separate border-spacing-0 text-left text-sm [&_tbody_tr:hover]:bg-surface-2/60", stack && "stack-table", className)} {...props} />
    </div>
  );
}

export function Th({ className, ...props }: ComponentProps<"th">) {
  return (
    <th
      className={cn(
        "border-b border-border bg-surface-2/70 px-4 py-2.5 text-[11px] font-semibold tracking-wider whitespace-nowrap text-muted uppercase first:pl-5 last:pr-5",
        className,
      )}
      {...props}
    />
  );
}
/** `label` is the column name shown beside the value when the table is stacked on a phone. */
export function Td({ className, label, children, ...props }: ComponentProps<"td"> & { label?: string }) {
  return (
    <td data-label={label} className={cn("border-b border-border px-4 py-3 align-middle first:pl-5 last:pr-5 [tr:last-child_&]:border-b-0", className)} {...props}>
      {label ? <div className="cell-body">{children}</div> : children}
    </td>
  );
}

// ---------------------------------------------------------------------------
// Data display
// ---------------------------------------------------------------------------
const statTones: Record<Tone, string> = {
  neutral: "",
  brand: "text-brand",
  success: "text-success",
  warning: "text-warning",
  danger: "text-danger",
  info: "text-info",
  accent: "text-accent",
};

export function Stat({
  label,
  value,
  hint,
  tone,
  icon,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: Tone;
  icon?: LucideIcon;
}) {
  return (
    <Card className="p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <p className="text-[13px] font-medium text-muted">{label}</p>
        {icon ? <IconBadge icon={icon} tone={tone && tone !== "neutral" ? tone : "brand"} size="sm" /> : null}
      </div>
      <p className={cn("mt-2 text-2xl font-bold tracking-tight tabular-nums sm:text-3xl", tone ? statTones[tone] : "")}>{value}</p>
      {hint ? <p className="mt-1 text-xs text-muted">{hint}</p> : null}
    </Card>
  );
}

export function Avatar({ src, name, size = 40 }: { src?: string | null; name: string; size?: number }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");
  return src ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={name}
      width={size}
      height={size}
      className="shrink-0 rounded-full object-cover ring-2 ring-surface"
      style={{ width: size, height: size }}
    />
  ) : (
    <span
      aria-hidden
      className="inline-flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand-soft to-accent-soft font-bold text-brand ring-2 ring-surface"
      style={{ width: size, height: size, fontSize: Math.max(11, size * 0.36) }}
    >
      {initials}
    </span>
  );
}
