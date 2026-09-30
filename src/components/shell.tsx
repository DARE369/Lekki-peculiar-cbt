"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
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
  structure: School,
  terminals: MonitorSmartphone,
  audit: ScrollText,
  staff: UserCog,
  sessions: ShieldCheck,
} satisfies Record<string, LucideIcon>;
export type NavIcon = keyof typeof ICONS;

export interface NavGroup {
  title: string;
  items: { href: string; label: string; icon: NavIcon; badge?: number }[];
}

export interface ShellUser {
  name: string;
  role: string;
  term: string | null;
}

function isActive(pathname: string, href: string) {
  return pathname === href || (href !== "/dashboard" && pathname.startsWith(href + "/"));
}

function NavList({ groups, onNavigate }: { groups: NavGroup[]; onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav className="space-y-7" aria-label="Main">
      {groups.map((g) => (
        <div key={g.title}>
          <p className="mb-2 px-3 text-[11px] font-semibold tracking-[0.08em] text-subtle uppercase">{g.title}</p>
          <ul className="space-y-0.5">
            {g.items.map((item) => {
              const active = isActive(pathname, item.href);
              const Icon = ICONS[item.icon];
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "group relative flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition-colors",
                      active ? "bg-brand-soft text-brand" : "text-muted hover:bg-surface-2 hover:text-text",
                    )}
                  >
                    {active ? <span className="absolute top-2 bottom-2 -left-3 w-1 rounded-r-full bg-brand" aria-hidden /> : null}
                    <Icon className={cn("size-[18px] shrink-0", active ? "text-brand" : "text-subtle group-hover:text-text")} aria-hidden />
                    <span className="flex-1 truncate">{item.label}</span>
                    {item.badge ? (
                      <span className="rounded-full bg-accent px-2 py-0.5 text-[11px] font-bold text-accent-ink tabular-nums">{item.badge}</span>
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
      <div className="flex items-center gap-3 rounded-2xl border border-border bg-surface-2/60 p-2.5">
        <Link href="/account" className="flex min-w-0 flex-1 items-center gap-3 rounded-xl hover:opacity-90">
          <Avatar name={user.name} size={36} />
          <span className="min-w-0 leading-tight">
            <span className="block truncate text-sm font-semibold">{user.name}</span>
            <span className="block truncate text-xs text-muted">{user.role}</span>
          </span>
        </Link>
        <form action={signOut}>
          <button
            className="inline-flex size-9 items-center justify-center rounded-xl text-muted hover:bg-surface hover:text-danger"
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
    <div className="min-h-screen lg:grid lg:grid-cols-[280px_minmax(0,1fr)]">
      {/* Desktop sidebar */}
      <aside className="no-print sticky top-0 hidden h-screen flex-col border-r border-border bg-surface lg:flex">
        <div className="px-6 pt-6 pb-5">
          <Link href="/dashboard" aria-label="Dashboard">
            <Logo />
          </Link>
        </div>
        <div className="flex-1 overflow-y-auto px-6 pb-6">
          <NavList groups={groups} />
        </div>
        <div className="border-t border-border p-4">
          <UserCard user={user} signOut={signOut} />
        </div>
      </aside>

      {/* Mobile drawer */}
      {open ? (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <button className="absolute inset-0 bg-black/40 backdrop-blur-sm" aria-label="Close menu" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 flex w-[86%] max-w-xs flex-col bg-surface shadow-float">
            <div className="flex items-center justify-between px-5 pt-5 pb-4">
              <Logo />
              <button className="inline-flex size-9 items-center justify-center rounded-xl hover:bg-surface-2" onClick={() => setOpen(false)} aria-label="Close menu">
                <X className="size-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-5 pb-6">
              <NavList groups={groups} onNavigate={() => setOpen(false)} />
            </div>
            <div className="border-t border-border p-4">
              <UserCard user={user} signOut={signOut} />
            </div>
          </div>
        </div>
      ) : null}

      <div className="min-w-0">
        <header className="no-print sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-border bg-bg/80 px-4 backdrop-blur-md sm:px-8">
          <button
            className="inline-flex size-10 items-center justify-center rounded-xl border border-border bg-surface lg:hidden"
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
            <span className="hidden items-center gap-2 rounded-full border border-border bg-surface px-3 py-1.5 text-xs font-medium text-muted sm:inline-flex">
              <span className="size-1.5 rounded-full bg-success" aria-hidden />
              {user.term}
            </span>
          ) : null}
          <ThemeSwitcher compact className="lg:hidden" />
          <Link href="/account" className="hidden items-center gap-2 rounded-full py-1 pr-1 pl-3 hover:bg-surface-2 sm:flex lg:hidden" aria-label="My account">
            <Avatar name={user.name} size={32} />
          </Link>
        </header>
        <main className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-8 sm:py-10">{children}</main>
      </div>
    </div>
  );
}
