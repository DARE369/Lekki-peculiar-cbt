import Link from "next/link";
import clsx from "clsx";
import { AlertTriangle, CheckCircle2, Inbox, Info, OctagonAlert, type LucideIcon } from "lucide-react";
import { Children, cloneElement, isValidElement, useId, type ComponentProps, type ReactElement, type ReactNode } from "react";

export const cn = clsx;

// ---------------------------------------------------------------------------
// Buttons
// ---------------------------------------------------------------------------
type Variant = "primary" | "secondary" | "ghost" | "danger" | "accent" | "soft";
const variants: Record<Variant, string> = {
  primary: "bg-brand text-brand-ink hover:bg-brand-hover",
  secondary: "border border-border-strong bg-surface text-text hover:bg-surface-2",
  ghost: "text-muted hover:bg-surface-2 hover:text-text",
  danger: "bg-danger text-white hover:brightness-110 dark:text-bg",
  accent: "bg-accent text-accent-ink hover:brightness-105",
  soft: "bg-brand-soft text-brand hover:bg-brand-soft/70",
};
const sizes = {
  sm: "h-8 gap-1.5 rounded-md px-3 text-[13px]",
  md: "h-9 gap-2 rounded-md px-3.5 text-sm",
  lg: "h-11 gap-2 rounded-lg px-5 text-[15px]",
};

export function buttonClass(variant: Variant = "primary", size: keyof typeof sizes = "md", extra?: string) {
  return cn(
    "inline-flex shrink-0 items-center justify-center font-medium whitespace-nowrap transition-colors duration-150",
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand",
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
  "rounded-md border border-border-strong bg-surface px-3 text-sm text-text placeholder:text-subtle " +
  "transition-colors focus:border-brand focus:outline-none focus:ring-2 focus:ring-[var(--ring)] " +
  "disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-muted";

/** Full width unless the caller sets its own width. */
const widthOf = (className?: string) => (/(^|\s)(w-|max-w-|flex-1|basis-)/.test(className ?? "") ? "" : "w-full");

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input className={cn(fieldBase, widthOf(className), "h-9", className)} {...props} />;
}
export function Select({ className, ...props }: ComponentProps<"select">) {
  return <select className={cn(fieldBase, widthOf(className), "h-9 cursor-pointer pr-8", className)} {...props} />;
}
export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return <textarea className={cn(fieldBase, widthOf(className), "py-2.5 leading-relaxed", className)} {...props} />;
}

const FIELD_CONTROLS = new Set<unknown>(["input", "select", "textarea", Input, Select, Textarea]);

/**
 * A labelled form control. When the child is a single input/select/textarea, the label is tied to it
 * with htmlFor/id (so a screen reader announces just "Class", not the label plus every option's text)
 * and the hint is linked with aria-describedby. Anything else falls back to a wrapping <label>.
 */
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
  const auto = useId();
  const only = Children.count(children) === 1 ? Children.toArray(children)[0] : null;
  const control = isValidElement(only) && FIELD_CONTROLS.has(only.type) ? (only as ReactElement<{ id?: string; "aria-describedby"?: string }>) : null;
  if (!control) {
    return (
      <label className={cn("block space-y-1.5", className)}>
        <span className="text-[13px] font-medium text-text">{label}</span>
        {children}
        {hint ? <span className="block text-xs leading-relaxed text-muted">{hint}</span> : null}
      </label>
    );
  }
  const id = control.props.id ?? auto;
  const hintId = hint ? `${id}-hint` : undefined;
  return (
    <div className={cn("space-y-1.5", className)}>
      <label htmlFor={id} className="block text-[13px] font-medium text-text">
        {label}
      </label>
      {cloneElement(control, { id, "aria-describedby": cn(control.props["aria-describedby"], hintId) || undefined })}
      {hint ? (
        <p id={hintId} className="text-xs leading-relaxed text-muted">
          {hint}
        </p>
      ) : null}
    </div>
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
  return <div className={cn("rounded-lg border border-border bg-surface", className)} {...props} />;
}

export function IconBadge({ icon: Icon, tone = "brand", size = "md" }: { icon: LucideIcon; tone?: Tone; size?: "sm" | "md" | "lg" }) {
  const box = { sm: "size-7 rounded-md [&_svg]:size-4", md: "size-9 rounded-md [&_svg]:size-5", lg: "size-10 rounded-lg [&_svg]:size-5" }[size];
  return (
    <span className={cn("inline-flex shrink-0 items-center justify-center", box, tones[tone])} aria-hidden>
      <Icon />
    </span>
  );
}

/** `icon` is accepted for compatibility but no longer drawn: section titles carry the meaning on their own. */
export function CardHeader({
  title,
  description,
  actions,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  icon?: LucideIcon;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-border px-4 py-3 sm:px-5">
      <div className="min-w-0">
        <h2 className="text-[15px] font-semibold">{title}</h2>
        {description ? <p className="mt-0.5 text-sm text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

/** `icon` is accepted for compatibility but not drawn: the title and the sidebar already say where you are. */
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
  icon?: LucideIcon;
}) {
  return (
    <div className="mb-6">
      {back ? (
        <Link href={back.href} className="no-print mb-2 inline-flex items-center gap-1 text-sm text-muted hover:text-text hover:underline">
          <span aria-hidden>←</span> {back.label}
        </Link>
      ) : null}
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          <h1 className="text-[22px] leading-tight font-semibold sm:text-2xl">{title}</h1>
          {description ? <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted">{description}</p> : null}
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
        "inline-flex items-center gap-1.5 rounded-sm px-1.5 py-0.5 text-xs font-medium whitespace-nowrap",
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
      className={cn("flex gap-3 rounded-md border px-3.5 py-3 text-sm", tones[tone], "border-current/20")}
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
  icon: EmptyIcon = Inbox,
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  icon?: LucideIcon;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-1.5 px-6 py-10 text-center">
      <EmptyIcon className="mb-1 size-6 text-subtle" aria-hidden />
      <p className="font-medium">{title}</p>
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
      <table className={cn("w-full border-separate border-spacing-0 text-left text-sm [&_tbody_tr:hover]:bg-surface-2", stack && "stack-table", className)} {...props} />
    </div>
  );
}

export function Th({ className, ...props }: ComponentProps<"th">) {
  return (
    <th
      className={cn(
        "border-b border-border bg-surface-2 px-3 py-2 text-xs font-medium whitespace-nowrap text-muted first:pl-4 last:pr-4 sm:first:pl-5 sm:last:pr-5",
        className,
      )}
      {...props}
    />
  );
}
/** `label` is the column name shown beside the value when the table is stacked on a phone. */
export function Td({ className, label, children, ...props }: ComponentProps<"td"> & { label?: string }) {
  return (
    <td data-label={label} className={cn("border-b border-border px-3 py-2.5 align-middle first:pl-4 last:pr-4 sm:first:pl-5 sm:last:pr-5 [tr:last-child_&]:border-b-0", className)} {...props}>
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

/** A figure with its label. `icon` is accepted for compatibility but not drawn. */
export function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: Tone;
  icon?: LucideIcon;
}) {
  return (
    <Card className="px-4 py-3.5">
      <p className="text-[13px] text-muted">{label}</p>
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
    <img
      src={src}
      alt={name}
      width={size}
      height={size}
      className="shrink-0 rounded-full object-cover"
      style={{ width: size, height: size }}
    />
  ) : (
    <span
      aria-hidden
      className="inline-flex shrink-0 items-center justify-center rounded-full bg-surface-3 font-semibold text-muted"
      style={{ width: size, height: size, fontSize: Math.max(11, size * 0.36) }}
    >
      {initials}
    </span>
  );
}
