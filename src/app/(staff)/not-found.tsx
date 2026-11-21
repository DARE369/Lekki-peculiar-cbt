import Link from "next/link";
import { SearchX } from "lucide-react";
import { buttonClass } from "@/components/ui";

export default function StaffNotFound() {
  return (
    <div className="mx-auto flex max-w-lg flex-col items-center py-16 text-center">
      <span className="animate-pop inline-flex size-12 items-center justify-center rounded-full bg-surface-2 text-muted">
        <SearchX className="size-6" aria-hidden />
      </span>
      <h1 className="mt-4 text-xl font-semibold">We couldn&apos;t find that</h1>
      <p className="mt-2 text-sm text-muted">It may have been deleted, or the link is out of date. You may also not have access to it.</p>
      <Link href="/dashboard" className={buttonClass("primary", "md", "mt-6")}>
        Go to the dashboard
      </Link>
    </div>
  );
}
