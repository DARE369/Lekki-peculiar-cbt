import { NextResponse } from "next/server";
import { sendDailyDigests } from "@/lib/digest";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

/** Called by Vercel Cron at the end of each school day (see vercel.json). Needs CRON_SECRET. */
export async function GET(req: Request) {
  const secret = env.cronSecret;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Not allowed." }, { status: 401 });
  }
  const result = await sendDailyDigests();
  return NextResponse.json(result);
}
