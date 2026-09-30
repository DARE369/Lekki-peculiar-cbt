import { ShieldAlert } from "lucide-react";
import { AuthLayout } from "@/components/auth-layout";
import { IconBadge } from "@/components/ui";
import { signOut } from "@/app/login/actions";

export default function NoAccess() {
  return (
    <AuthLayout title="No staff access">
      <IconBadge icon={ShieldAlert} tone="warning" size="lg" />
      <p className="mt-5 leading-relaxed text-muted">
        You are signed in, but this account isn&apos;t an active staff account. Ask the school administrator to add you.
      </p>
      <form action={signOut} className="mt-8">
        <button className="font-semibold text-brand hover:underline">Sign out</button>
      </form>
    </AuthLayout>
  );
}
