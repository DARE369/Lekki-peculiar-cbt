import { cn } from "@/components/ui";

/** A grey placeholder block that shimmers while the real content loads. */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("skeleton", className)} aria-hidden />;
}

/** Title and description placeholders, matching PageHeader. */
function HeaderSkeleton({ tabs }: { tabs?: number }) {
  return (
    <div className="mb-6 space-y-2">
      <Skeleton className="h-7 w-56" />
      <Skeleton className="h-4 w-full max-w-md" />
      {tabs ? (
        <div className="flex gap-2 pt-4">
          {Array.from({ length: tabs }, (_, i) => (
            <Skeleton key={i} className="h-8 w-28" />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function Loading({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <div role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}

/** A page that is mostly one list or table. */
export function ListPageSkeleton({ label = "Loading…", tabs, rows = 6 }: { label?: string; tabs?: number; rows?: number }) {
  return (
    <Loading label={label}>
      <HeaderSkeleton tabs={tabs} />
      <div className="rounded-lg border border-border bg-surface">
        <div className="border-b border-border px-5 py-3">
          <Skeleton className="h-5 w-40" />
        </div>
        <ul className="divide-y divide-border">
          {Array.from({ length: rows }, (_, i) => (
            <li key={i} className="flex items-center gap-4 px-5 py-4">
              <Skeleton className="size-9 shrink-0" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-3 w-1/3" />
              </div>
              <Skeleton className="hidden h-8 w-20 sm:block" />
            </li>
          ))}
        </ul>
      </div>
    </Loading>
  );
}

/** A page of cards, like the dashboard or Settings. */
export function CardsPageSkeleton({ label = "Loading…", cards = 4, tabs }: { label?: string; cards?: number; tabs?: number }) {
  return (
    <Loading label={label}>
      <HeaderSkeleton tabs={tabs} />
      <div className="grid gap-3 sm:grid-cols-2">
        {Array.from({ length: cards }, (_, i) => (
          <div key={i} className="flex gap-3 rounded-lg border border-border bg-surface p-4">
            <Skeleton className="size-9 shrink-0" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-5 w-24" />
            </div>
          </div>
        ))}
      </div>
    </Loading>
  );
}

/** A test or review page: questions on the left, settings on the right. */
export function DetailPageSkeleton({ label = "Loading…" }: { label?: string }) {
  return (
    <Loading label={label}>
      <HeaderSkeleton />
      <div className="grid gap-6 xl:grid-cols-[1fr_420px]">
        <div className="rounded-lg border border-border bg-surface">
          <div className="border-b border-border px-5 py-3">
            <Skeleton className="h-5 w-36" />
          </div>
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="space-y-2 border-b border-border px-5 py-4 last:border-0">
              <Skeleton className="h-4 w-3/4" />
              <div className="grid grid-cols-2 gap-2">
                <Skeleton className="h-3 w-2/3" />
                <Skeleton className="h-3 w-1/2" />
              </div>
            </div>
          ))}
        </div>
        <div className="space-y-4 rounded-lg border border-border bg-surface p-5">
          <Skeleton className="h-5 w-24" />
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="space-y-1.5">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-9 w-full" />
            </div>
          ))}
        </div>
      </div>
    </Loading>
  );
}

/** The dashboard: greeting, a to-do panel and two columns. */
export function DashboardSkeleton() {
  return (
    <Loading label="Loading your dashboard…">
      <div className="space-y-8">
        <div className="space-y-2">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-8 w-64" />
        </div>
        <div className="space-y-3 rounded-lg border border-border bg-surface p-5">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-2/3" />
        </div>
        <div className="grid gap-6 lg:grid-cols-2">
          <Skeleton className="h-56 w-full" />
          <Skeleton className="h-56 w-full" />
        </div>
      </div>
    </Loading>
  );
}
