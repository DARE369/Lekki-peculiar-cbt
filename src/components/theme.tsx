"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/components/ui";

export type ThemePref = "light" | "dark" | "system";
const KEY = "lp-theme";

/**
 * Runs in <head> before first paint: resolves light/dark/system to data-theme on <html>
 * and keeps following the OS while the preference is "system".
 */
export const themeInitScript = `(function(){try{var d=document.documentElement,p=localStorage.getItem("${KEY}")||"light",m=window.matchMedia("(prefers-color-scheme: dark)");function a(){var t=p==="system"?(m.matches?"dark":"light"):p;d.setAttribute("data-theme",t);d.setAttribute("data-theme-pref",p)}a();m.addEventListener("change",function(){p=localStorage.getItem("${KEY}")||"light";a()})}catch(e){}})()`;

function readPref(): ThemePref {
  if (typeof document === "undefined") return "light";
  return (document.documentElement.getAttribute("data-theme-pref") as ThemePref) || "light";
}

function apply(pref: ThemePref) {
  try {
    localStorage.setItem(KEY, pref);
  } catch {}
  const dark = pref === "dark" || (pref === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
  document.documentElement.setAttribute("data-theme-pref", pref);
}

const OPTIONS: { value: ThemePref; label: string; Icon: typeof Sun }[] = [
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
  { value: "system", label: "System", Icon: Monitor },
];

/** Segmented Light / Dark / System switch. */
export function ThemeSwitcher({ className, compact = false }: { className?: string; compact?: boolean }) {
  const [pref, setPref] = useState<ThemePref>("light");
  useEffect(() => {
    // Sync with what the head script resolved (runs once after hydration).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPref(readPref());
  }, []);
  return (
    <div
      role="radiogroup"
      aria-label="Colour theme"
      className={cn("inline-flex items-center gap-0.5 rounded-full border border-border bg-surface-2 p-0.5", className)}
    >
      {OPTIONS.map(({ value, label, Icon }) => {
        const active = pref === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={active}
            title={`${label} theme`}
            onClick={() => {
              setPref(value);
              apply(value);
            }}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-colors",
              active ? "bg-surface text-text shadow-soft" : "text-muted hover:text-text",
            )}
          >
            <Icon className="size-3.5" aria-hidden />
            {compact ? <span className="sr-only">{label}</span> : label}
          </button>
        );
      })}
    </div>
  );
}
