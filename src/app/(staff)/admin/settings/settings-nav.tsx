import Link from "next/link";
import { cn } from "@/components/ui";
import type { StaffContext } from "@/lib/auth";
import { settingsPages, type SettingsKey } from "./sections";

/** The tabs across the top of every settings page, so moving between them is one click. */
export function SettingsNav({ staff, active }: { staff: StaffContext; active: SettingsKey }) {
  return (
    <nav aria-label="Settings" className="no-print -mx-4 mb-6 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <ul className="flex w-max gap-1 rounded-lg border border-border bg-surface p-1 text-sm sm:w-auto sm:flex-wrap">
        {settingsPages(staff).map((p) => (
          <li key={p.key}>
            <Link
              href={p.href}
              aria-current={p.key === active ? "page" : undefined}
              className={cn(
                "block rounded-md px-3 py-1.5 whitespace-nowrap transition-colors",
                p.key === active ? "bg-brand font-medium text-brand-ink" : "text-muted hover:bg-surface-2 hover:text-text",
              )}
            >
              {p.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
