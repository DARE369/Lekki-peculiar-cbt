"use client";

import { useEffect } from "react";
import Link from "next/link";
import { RotateCcw, TriangleAlert } from "lucide-react";
import { Button, buttonClass } from "@/components/ui";

/** When a staff page fails to load: say so plainly, keep the menu, and offer to try again. */
export default function StaffError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div className="mx-auto flex max-w-lg flex-col items-center py-16 text-center" role="alert">
      <span className="animate-pop inline-flex size-12 items-center justify-center rounded-full bg-danger-soft text-danger">
        <TriangleAlert className="size-6" aria-hidden />
      </span>
      <h1 className="mt-4 text-xl font-semibold">This page didn&apos;t load</h1>
      <p className="mt-2 text-sm text-muted">
        Nothing you saved has been lost. It is usually a dropped connection: try again. If it keeps happening, tell the school office
        {error.digest ? (
          <>
            {" "}and give them this code: <span className="font-mono font-semibold text-text">{error.digest}</span>
          </>
        ) : null}
        .
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        <Button onClick={reset}>
          <RotateCcw className="mr-2 size-4" aria-hidden />
          Try again
        </Button>
        <Link href="/dashboard" className={buttonClass("secondary")}>
          Go to the dashboard
        </Link>
      </div>
    </div>
  );
}
