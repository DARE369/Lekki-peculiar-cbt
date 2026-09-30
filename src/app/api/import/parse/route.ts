import { NextResponse } from "next/server";
import { getStaff } from "@/lib/auth";
import { parseXlsx } from "@/lib/import/xlsx";

// Excel files are parsed on the server (keeps the Excel library out of the browser bundle).
export async function POST(request: Request) {
  if (!(await getStaff())) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const fd = await request.formData();
  const file = fd.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "No file" }, { status: 400 });
  if (file.size > 5 * 1024 * 1024) return NextResponse.json({ error: "File is larger than 5 MB" }, { status: 413 });
  return NextResponse.json(await parseXlsx(await file.arrayBuffer()));
}
