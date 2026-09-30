import { Logo } from "@/components/brand";
import { Card } from "@/components/ui";
import { signOut } from "@/app/login/actions";

export default function NoAccess() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <Card className="w-full max-w-md p-6">
        <Logo />
        <h1 className="mt-6 text-xl font-semibold">No staff access</h1>
        <p className="mt-2 text-sm text-muted">
          You are signed in, but this account isn&apos;t an active staff account. Ask the school administrator to add you.
        </p>
        <form action={signOut} className="mt-6">
          <button className="text-sm text-brand hover:underline">Sign out</button>
        </form>
      </Card>
    </main>
  );
}
