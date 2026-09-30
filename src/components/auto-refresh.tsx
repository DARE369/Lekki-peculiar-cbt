"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

/** Re-renders the server page every few seconds (live monitors). Pauses while the tab is hidden. */
export function AutoRefresh({ seconds = 10 }: { seconds?: number }) {
  const router = useRouter();
  const [on, setOn] = useState(true);
  const [last, setLast] = useState(() => new Date());
  useEffect(() => {
    if (!on) return;
    const t = setInterval(() => {
      if (document.visibilityState === "visible") {
        router.refresh();
        setLast(new Date());
      }
    }, seconds * 1000);
    return () => clearInterval(t);
  }, [on, seconds, router]);
  return (
    <label className="no-print flex items-center gap-2 text-xs text-muted">
      <input type="checkbox" checked={on} onChange={(e) => setOn(e.target.checked)} className="accent-[var(--brand)]" />
      Auto-refresh every {seconds}s · updated {last.toLocaleTimeString("en-NG", { hour: "numeric", minute: "2-digit", second: "2-digit" })}
    </label>
  );
}
