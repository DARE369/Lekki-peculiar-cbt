"use client";

import { useState } from "react";
import { cn } from "@/components/ui";

/**
 * An on/off switch that saves as soon as it is flipped: it submits the form it sits in.
 * Built on a real checkbox, so keyboards and screen readers treat it as one.
 */
export function AutoSwitch({ name, defaultChecked, label, disabled }: { name: string; defaultChecked: boolean; label: string; disabled?: boolean }) {
  const [on, setOn] = useState(defaultChecked);
  return (
    <label className={cn("inline-flex cursor-pointer items-center gap-3", disabled && "cursor-not-allowed opacity-60")}>
      <input
        type="checkbox"
        role="switch"
        name={name}
        checked={on}
        disabled={disabled}
        aria-checked={on}
        onChange={(e) => {
          setOn(e.target.checked);
          e.target.form?.requestSubmit();
        }}
        className="peer sr-only"
      />
      <span
        aria-hidden
        className={cn(
          "relative inline-block h-6 w-11 shrink-0 rounded-full transition-colors duration-200 peer-focus-visible:ring-2 peer-focus-visible:ring-brand peer-focus-visible:ring-offset-2",
          on ? "bg-brand" : "bg-border-strong",
        )}
      >
        <span className={cn("absolute top-0.5 left-0.5 size-5 rounded-full bg-white shadow transition-transform duration-200", on && "translate-x-5")} />
      </span>
      <span className="text-sm font-medium">{label}</span>
    </label>
  );
}
