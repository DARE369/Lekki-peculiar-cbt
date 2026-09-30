"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/components/ui";

export interface NavGroup {
  title: string;
  items: { href: string; label: string; badge?: number }[];
}

export function StaffNav({ groups }: { groups: NavGroup[] }) {
  const pathname = usePathname();
  return (
    <nav className="space-y-6">
      {groups.map((g) => (
        <div key={g.title}>
          <p className="mb-1.5 px-3 text-[11px] font-semibold tracking-wider text-muted uppercase">{g.title}</p>
          <ul className="space-y-0.5">
            {g.items.map((item) => {
              const active = pathname === item.href || (item.href !== "/dashboard" && pathname.startsWith(item.href + "/"));
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className={cn(
                      "flex items-center justify-between rounded-lg px-3 py-2 text-sm",
                      active ? "bg-brand-soft font-medium text-brand" : "text-text hover:bg-surface-2",
                    )}
                  >
                    {item.label}
                    {item.badge ? (
                      <span className="rounded-full bg-accent px-1.5 text-xs font-semibold text-black">{item.badge}</span>
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
