import "server-only";
import { headers } from "next/headers";

/** The address people use to reach this app (e.g. https://lekki-peculiar-cbt.vercel.app). */
export async function siteOrigin() {
  const h = await headers();
  const proto = h.get("x-forwarded-proto") ?? "https";
  return `${proto}://${h.get("x-forwarded-host") ?? h.get("host")}`;
}
