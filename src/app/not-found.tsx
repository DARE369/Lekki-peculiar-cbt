import Link from "next/link";
import { buttonClass } from "@/components/ui";

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-bg p-6 text-center">
      <p className="text-sm font-semibold text-brand">404</p>
      <h1 className="mt-2 text-2xl font-semibold">This page doesn&apos;t exist</h1>
      <p className="mt-2 max-w-sm text-sm text-muted">Check the address, or start again from the home page.</p>
      <Link href="/" className={buttonClass("primary", "md", "mt-6")}>
        Go to the home page
      </Link>
    </main>
  );
}
