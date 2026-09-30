"use client";

import { buttonClass } from "@/components/ui";

export function PrintButton() {
  return (
    <button type="button" className={buttonClass("secondary", "md", "no-print")} onClick={() => window.print()}>
      Print
    </button>
  );
}
