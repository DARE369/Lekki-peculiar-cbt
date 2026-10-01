import type { Metadata } from "next";
import { AuthLayout } from "@/components/auth-layout";
import { ConfirmFromLink } from "./confirm";

export const metadata: Metadata = { title: "Signing you in" };

export default async function ConfirmPage(props: PageProps<"/auth/confirm">) {
  const { next } = await props.searchParams;
  const safe = typeof next === "string" && next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";
  return (
    <AuthLayout title="Signing you in…">
      <ConfirmFromLink next={safe} />
    </AuthLayout>
  );
}
