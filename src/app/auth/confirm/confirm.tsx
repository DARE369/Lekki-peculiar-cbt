"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Alert } from "@/components/ui";
import { adoptSession } from "./actions";

export function ConfirmFromLink({ next }: { next: string }) {
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    const hash = new URLSearchParams(window.location.hash.slice(1));
    // Don't leave tokens in the address bar or browser history.
    history.replaceState(null, "", window.location.pathname + window.location.search);
    const access = hash.get("access_token");
    const refresh = hash.get("refresh_token");
    if (!access || !refresh) {
      const code = hash.get("error_code");
      queueMicrotask(() =>
        setProblem(
          code === "otp_expired" || !hash.get("error")
            ? "This link has expired or was already used. Links work once and only for a limited time."
            : (hash.get("error_description") ?? "This link didn't work."),
        ),
      );
      return;
    }
    adoptSession(access, refresh).then((r) => {
      if (r.ok) window.location.replace(next);
      else setProblem("This link has expired or was already used.");
    });
  }, [next]);

  if (!problem) return <p className="text-muted">One moment…</p>;
  return (
    <div className="space-y-4">
      <Alert tone="warning">{problem}</Alert>
      <p className="text-sm text-muted">
        Ask the administrator to send a new invitation, use <strong>Forgot password?</strong> on the{" "}
        <Link href="/login" className="font-semibold text-brand hover:underline">
          sign-in page
        </Link>
        , or use Continue with Google.
      </p>
    </div>
  );
}
