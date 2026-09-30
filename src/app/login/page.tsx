import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Logo } from "@/components/brand";
import { Card } from "@/components/ui";
import { getStaff } from "@/lib/auth";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Staff sign in" };

export default async function LoginPage(props: PageProps<"/login">) {
  const { next } = await props.searchParams;
  if (await getStaff()) redirect("/dashboard");
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <Link href="/" className="mb-8 inline-block">
          <Logo />
        </Link>
        <Card className="p-6">
          <h1 className="text-xl font-semibold">Staff sign in</h1>
          <p className="mt-1 mb-6 text-sm text-muted">Use your official school email.</p>
          <LoginForm next={typeof next === "string" ? next : "/dashboard"} />
        </Card>
        <p className="mt-6 text-center text-xs text-muted">
          Students don&apos;t sign in here — use the <Link href="/exam" className="underline">exam screen</Link> on a lab computer.
        </p>
      </div>
    </main>
  );
}
