import Link from "next/link";
import clsx from "clsx";
import type { ComponentProps, ReactNode } from "react";

export const cn = clsx;

type Variant = "primary" | "secondary" | "ghost" | "danger";
const variants: Record<Variant, string> = {
  primary: "bg-brand text-white hover:bg-brand-strong dark:text-bg",
  secondary: "bg-surface text-text border border-border hover:bg-surface-2",
  ghost: "text-text hover:bg-surface-2",
  danger: "bg-danger text-white hover:opacity-90 dark:text-bg",
};
const sizes = { sm: "h-8 px-3 text-sm", md: "h-10 px-4 text-sm", lg: "h-12 px-6 text-base" };

export function buttonClass(variant: Variant = "primary", size: keyof typeof sizes = "md", extra?: string) {
  return cn(
    "inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors",
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand",
    "disabled:pointer-events-none disabled:opacity-50",
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

const fieldBase =
  "w-full rounded-lg border border-border bg-surface px-3 text-sm text-text placeholder:text-muted " +
  "focus:outline-2 focus:outline-offset-0 focus:outline-brand disabled:opacity-60";

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input className={cn(fieldBase, "h-10", className)} {...props} />;
}
export function Select({ className, ...props }: ComponentProps<"select">) {
  return <select className={cn(fieldBase, "h-10", className)} {...props} />;
}
export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return <textarea className={cn(fieldBase, "py-2", className)} {...props} />;
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
      <span className="text-sm font-medium">{label}</span>
      {children}
      {hint ? <span className="block text-xs text-muted">{hint}</span> : null}
    </label>
  );
}

export function Checkbox({ label, hint, ...props }: ComponentProps<"input"> & { label: string; hint?: string }) {
  return (
    <label className="flex items-start gap-3 text-sm">
      <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[var(--brand)]" {...props} />
      <span>
        <span className="font-medium">{label}</span>
        {hint ? <span className="block text-xs text-muted">{hint}</span> : null}
      </span>
    </label>
  );
}

export function Card({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("rounded-xl border border-border bg-surface", className)} {...props} />;
}

export function CardHeader({ title, description, actions }: { title: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-4">
      <div>
        <h2 className="font-semibold">{title}</h2>
        {description ? <p className="mt-0.5 text-sm text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
  back,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  back?: { href: string; label: string };
}) {
  return (
    <div className="mb-6">
      {back ? (
        <Link href={back.href} className="mb-2 inline-block text-sm text-muted hover:text-text">
          ← {back.label}
        </Link>
      ) : null}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {description ? <p className="mt-1 text-sm text-muted">{description}</p> : null}
        </div>
        {actions ? <div className="no-print flex flex-wrap gap-2">{actions}</div> : null}
      </div>
    </div>
  );
}

type Tone = "neutral" | "brand" | "success" | "warning" | "danger" | "info";
const tones: Record<Tone, string> = {
  neutral: "bg-surface-2 text-muted",
  brand: "bg-brand-soft text-brand",
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  danger: "bg-danger-soft text-danger",
  info: "bg-info-soft text-info",
};
export function Badge({ tone = "neutral", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap", tones[tone], className)}>
      {children}
    </span>
  );
}

export function Alert({ tone = "info", title, children }: { tone?: Tone; title?: ReactNode; children?: ReactNode }) {
  return (
    <div className={cn("rounded-lg px-4 py-3 text-sm", tones[tone])} role={tone === "danger" ? "alert" : "status"}>
      {title ? <p className="font-semibold">{title}</p> : null}
      {children ? <div className={title ? "mt-1" : ""}>{children}</div> : null}
    </div>
  );
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
      <p className="font-medium">{title}</p>
      {children ? <p className="max-w-md text-sm text-muted">{children}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

export function Table({ className, ...props }: ComponentProps<"table">) {
  return (
    <div className="overflow-x-auto">
      <table className={cn("w-full text-left text-sm", className)} {...props} />
    </div>
  );
}
export function Th({ className, ...props }: ComponentProps<"th">) {
  return (
    <th
      className={cn("border-b border-border bg-surface-2 px-4 py-2.5 text-xs font-semibold tracking-wide text-muted uppercase", className)}
      {...props}
    />
  );
}
export function Td({ className, ...props }: ComponentProps<"td">) {
  return <td className={cn("border-b border-border px-4 py-2.5 align-middle", className)} {...props} />;
}

const statTones: Record<Tone, string> = {
  neutral: "",
  brand: "text-brand",
  success: "text-success",
  warning: "text-warning",
  danger: "text-danger",
  info: "text-info",
};

export function Stat({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: Tone }) {
  return (
    <Card className="p-4">
      <p className="text-xs font-medium tracking-wide text-muted uppercase">{label}</p>
      <p className={cn("mt-1 text-2xl font-semibold tabular-nums", tone ? statTones[tone] : "")}>{value}</p>
      {hint ? <p className="mt-0.5 text-xs text-muted">{hint}</p> : null}
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
    <img src={src} alt={name} width={size} height={size} className="shrink-0 rounded-full object-cover" style={{ width: size, height: size }} />
  ) : (
    <span
      aria-hidden
      className="inline-flex shrink-0 items-center justify-center rounded-full bg-brand-soft font-semibold text-brand"
      style={{ width: size, height: size, fontSize: size * 0.38 }}
    >
      {initials}
    </span>
  );
}
