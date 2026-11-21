"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { startTransition, useEffect, useRef, useState } from "react";
import {
  CalendarDays,
  Settings,
  BarChart3,
  BookOpenCheck,
  CalendarClock,
  ClipboardCheck,
  FileQuestion,
  GraduationCap,
  LayoutDashboard,
  LogOut,
  Menu,
  MonitorSmartphone,
  ScrollText,
  School,
  ShieldCheck,
  UserCog,
  Users,
  UsersRound,
  X,
  type LucideIcon,
  ListChecks,
  Tag,
  TriangleAlert,
  ClipboardList,
} from "lucide-react";
import { Logo } from "@/components/brand";
import { ThemeSwitcher } from "@/components/theme";
import { Avatar, cn } from "@/components/ui";

const ICONS = {
  dashboard: LayoutDashboard,
  classes: UsersRound,
  questions: FileQuestion,
  tests: BookOpenCheck,
  reports: BarChart3,
  approvals: ClipboardCheck,
  exams: CalendarClock,
  students: GraduationCap,
  assignments: Users,
  progress: ListChecks,
  structure: School,
  terminals: MonitorSmartphone,
  audit: ScrollText,
  staff: UserCog,
  sessions: ShieldCheck,
  rounds: Tag,
  calendar: CalendarDays,
  settings: Settings,
  problems: TriangleAlert,
  papers: ClipboardList,
} satisfies Record<string, LucideIcon>;
export type NavIcon = keyof typeof ICONS;

export interface NavGroup {
  title: string;
  items: { href: string; label: string; icon: NavIcon; badge?: number; /** other paths that count as this item */ also?: string[]; /** the count means something is waiting right now */ urgent?: boolean }[];
}

export interface ShellUser {
  name: string;
  role: string;
  term: string | null;
}

function isActive(pathname: string, href: string) {
  // Strip query string from href before comparing — pathname never includes it.
  const hrefPath = href.split("?")[0];
  return pathname === hrefPath || (hrefPath !== "/dashboard" && pathname.startsWith(hrefPath + "/"));
}

/** Thin progress bar shown during page-to-page navigations. */
function NavigationProgress() {
  const pathname = usePathname();
  const [active, setActive] = useState(false);
  // Track latest pathname so we don't trigger on same-page clicks.
  const lastPathname = useRef(pathname);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      const anchor = (e.target as Element).closest("a");
      if (!anchor || !anchor.href || anchor.target || e.ctrlKey || e.metaKey || e.shiftKey) return;
      try {
        const url = new URL(anchor.href);
        if (url.origin !== window.location.origin) return;
        if (url.pathname !== lastPathname.current) setActive(true);
      } catch {
        // non-parseable href — ignore
      }
    }
    document.addEventListener("click", handleClick, true);
    return () => document.removeEventListener("click", handleClick, true);
  }, []);

  // Hide once the new page has arrived.
  useEffect(() => {
    lastPathname.current = pathname;
    startTransition(() => setActive(false));
  }, [pathname]);

  return (
    <div
      aria-hidden
      className={`pointer-events-none fixed inset-x-0 top-0 z-[200] h-[3px] transition-opacity duration-300 ${active ? "opacity-100" : "opacity-0"}`}
    >
      <div className={`h-full bg-brand origin-left ${active ? "animate-[nav-progress_2s_ease-in-out_infinite]" : ""}`} />
    </div>
  );
}

function NavList({ groups, onNavigate }: { groups: NavGroup[]; onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav className="space-y-5" aria-label="Main">
      {groups.map((g) => (
        <div key={g.title}>
          <p className="mb-1 px-2.5 text-xs font-medium text-subtle">{g.title}</p>
          <ul className="space-y-px">
            {g.items.map((item) => {
              const active = isActive(pathname, item.href) || (item.also ?? []).some((h) => isActive(pathname, h));
              const Icon = ICONS[item.icon];
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "group relative flex min-h-9 items-center gap-2.5 rounded-md px-2.5 text-sm transition-colors",
                      active ? "bg-surface-2 font-semibold text-text" : "text-muted hover:bg-surface-2 hover:text-text",
                    )}
                  >
                    {active ? <span className="absolute inset-y-1.5 -left-3 w-[3px] rounded-r bg-brand" aria-hidden /> : null}
                    <Icon className={cn("size-4 shrink-0", active ? "text-brand" : "text-subtle group-hover:text-muted")} aria-hidden />
                    <span className="flex-1 truncate">{item.label}</span>
                    {item.badge ? (
                      <span
                        className={cn(
                          "animate-pop min-w-5 rounded-full px-1.5 text-center text-xs font-semibold tabular-nums",
                          item.urgent ? "animate-attention bg-danger text-white" : "bg-accent text-accent-ink",
                        )}
                        aria-label={`${item.badge} waiting`}
                      >
                        {item.badge}
                      </span>
                    ) : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function UserCard({ user, signOut }: { user: ShellUser; signOut: () => Promise<void> }) {
  return (
    <div className="space-y-3">
      <ThemeSwitcher className="w-full justify-between" />
      <div className="flex items-center gap-2.5">
        <Link href="/account" className="flex min-w-0 flex-1 items-center gap-2.5 rounded-md p-1 -m-1 hover:bg-surface-2">
          <Avatar name={user.name} size={32} />
          <span className="min-w-0 leading-tight">
            <span className="block truncate text-sm font-semibold">{user.name}</span>
            <span className="block truncate text-xs text-muted">{user.role}</span>
          </span>
        </Link>
        <form action={signOut}>
          <button
            className="inline-flex size-9 items-center justify-center rounded-md text-muted hover:bg-surface-2 hover:text-danger"
            title="Sign out"
            aria-label="Sign out"
          >
            <LogOut className="size-4" />
          </button>
        </form>
      </div>
    </div>
  );
}

export function AppShell({
  groups,
  user,
  signOut,
  children,
}: {
  groups: NavGroup[];
  user: ShellUser;
  signOut: () => Promise<void>;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  // Close the drawer after navigating.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[248px_minmax(0,1fr)]">
      <NavigationProgress />
      {/* Desktop sidebar */}
      <aside className="no-print sticky top-0 hidden h-screen flex-col border-r border-border bg-surface lg:flex">
        <div className="px-5 pt-5 pb-4">
          <Link href="/dashboard" aria-label="Dashboard">
            <Logo />
          </Link>
        </div>
        <div className="flex-1 overflow-y-auto px-3 pb-6 [&_nav]:pl-0">
          <NavList groups={groups} />
        </div>
        <div className="border-t border-border p-4">
          <UserCard user={user} signOut={signOut} />
        </div>
      </aside>

      {/* Mobile drawer */}
      {open ? (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <button className="absolute inset-0 bg-black/40" aria-label="Close menu" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 flex w-[86%] max-w-xs flex-col bg-surface shadow-float">
            <div className="flex items-center justify-between px-5 pt-5 pb-4">
              <Logo />
              <button className="inline-flex size-10 items-center justify-center rounded-md hover:bg-surface-2" onClick={() => setOpen(false)} aria-label="Close menu">
                <X className="size-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-3 pb-6">
              <NavList groups={groups} onNavigate={() => setOpen(false)} />
            </div>
            <div className="border-t border-border p-4">
              <UserCard user={user} signOut={signOut} />
            </div>
          </div>
        </div>
      ) : null}

      <div className="min-w-0">
        <header className="no-print sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-surface px-4 sm:px-8 lg:bg-bg">
          <button
            className="inline-flex size-10 items-center justify-center rounded-md border border-border bg-surface lg:hidden"
            onClick={() => setOpen(true)}
            aria-label="Open menu"
          >
            <Menu className="size-5" />
          </button>
          <Link href="/dashboard" className="lg:hidden">
            <Logo compact />
          </Link>
          <div className="flex-1" />
          {user.term ? (
            <span className="hidden text-sm text-muted sm:inline">{user.term}</span>
          ) : null}
          <ThemeSwitcher compact className="lg:hidden" />
          <Link href="/account" className="hidden items-center gap-2 rounded-full py-1 pr-1 pl-3 hover:bg-surface-2 sm:flex lg:hidden" aria-label="My account">
            <Avatar name={user.name} size={32} />
          </Link>
        </header>
        <main key={pathname} className="animate-enter mx-auto w-full max-w-7xl px-4 py-6 sm:px-8 sm:py-8">
          {children}
        </main>
      </div>
    </div>
  );
}
