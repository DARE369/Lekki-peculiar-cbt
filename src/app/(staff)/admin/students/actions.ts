"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { can, requireAdmin } from "@/lib/auth";
import { bool, fail, ok, str, type ActionResult } from "@/lib/actions";
import { getStructure } from "@/lib/data";
import { normalizeAdmission, normalizeClassName } from "@/lib/import/students";
import { readSheetCells } from "@/lib/import/xlsx";
import { PHOTO_BUCKET } from "@/lib/photos";
import { createAdminClient, createClient } from "@/lib/supabase/server";

async function requireStudentManager() {
  const staff = await requireAdmin();
  if (!can(staff, "students.manage")) throw new Error("You need the 'Manage students' permission.");
  return staff;
}

export async function saveStudent(_: ActionResult, fd: FormData): Promise<ActionResult> {
  let staff;
  try {
    staff = await requireStudentManager();
  } catch (e) {
    return fail(e);
  }
  const id = str(fd, "id");
  const row = {
    admission_no: str(fd, "admission_no"),
    first_name: str(fd, "first_name"),
    last_name: str(fd, "last_name"),
    other_names: str(fd, "other_names") || null,
    gender: (["M", "F"].includes(str(fd, "gender")) ? str(fd, "gender") : null) as "M" | "F" | null,
    class_id: str(fd, "class_id") || null,
    active: id ? bool(fd, "active") : true,
  };
  if (!row.admission_no || !row.first_name || !row.last_name) return fail("Admission number, first name and surname are required.");
  const supabase = await createClient();
  if (id) {
    const { error } = await supabase.from("students").update(row).eq("id", id);
    if (error) return fail(error.message.includes("duplicate") ? "Another student already has that admission number." : error);
    revalidatePath(`/admin/students/${id}`);
    return ok("Saved.");
  }
  const { data, error } = await supabase
    .from("students")
    .insert({ ...row, school_id: staff.schoolId })
    .select("id")
    .single();
  if (error) return fail(error.message.includes("duplicate") ? "Another student already has that admission number." : error);
  redirect(`/admin/students/${data.id}`);
}

const importRow = z.object({
  admission_no: z.string().trim().min(1).max(50),
  first_name: z.string().trim().min(1).max(100),
  last_name: z.string().trim().min(1).max(100),
  other_names: z.string().trim().max(100).optional().default(""),
  gender: z.string().trim().optional().default(""),
  class_name: z.string().trim().optional().default(""),
});

/** Reads an uploaded Excel file into plain cells for the import preview. */
export async function readStudentSheet(fd: FormData): Promise<{ cells: string[][] } | { error: string }> {
  try {
    await requireStudentManager();
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Not allowed" };
  }
  const file = fd.get("file");
  if (!(file instanceof File)) return { error: "No file chosen." };
  if (file.size > 3 * 1024 * 1024) return { error: "The file is larger than 3 MB." };
  const cells = await readSheetCells(await file.arrayBuffer());
  return cells ? { cells } : { error: "Could not read this Excel file. Save it as .xlsx (or CSV) and try again." };
}

/**
 * Bulk create/update students from rows parsed in the browser. Matches classes by name.
 * With skipUnknownClasses, rows whose class doesn't exist (e.g. Pre-School) are left out instead of stopping the import.
 */
export async function importStudents(rows: unknown[], opts: { skipUnknownClasses?: boolean } = {}): Promise<ActionResult> {
  let staff;
  try {
    staff = await requireStudentManager();
  } catch (e) {
    return fail(e);
  }
  if (!Array.isArray(rows) || rows.length === 0) return fail("No rows to import.");
  if (rows.length > 3000) return fail("Import at most 3000 students at a time.");
  const s = await getStructure();
  const classByName = new Map(s.classes.map((c) => [normalizeClassName(c.name), c.id]));
  const problems: string[] = [];
  const skipped = new Map<string, number>();
  const records = [];
  for (const [i, raw] of rows.entries()) {
    const parsed = importRow.safeParse(raw);
    if (!parsed.success) {
      problems.push(`Row ${i + 2}: missing admission number, first name or surname`);
      continue;
    }
    const r = parsed.data;
    const classId = r.class_name ? classByName.get(normalizeClassName(r.class_name)) : null;
    if (r.class_name && !classId && opts.skipUnknownClasses) {
      skipped.set(r.class_name, (skipped.get(r.class_name) ?? 0) + 1);
      continue;
    }
    if (r.class_name && !classId) {
      problems.push(`Row ${i + 2}: class "${r.class_name}" not found`);
      continue;
    }
    const g = r.gender.toUpperCase().slice(0, 1);
    records.push({
      school_id: staff.schoolId,
      admission_no: r.admission_no,
      first_name: r.first_name,
      last_name: r.last_name,
      other_names: r.other_names || null,
      gender: g === "M" || g === "F" ? g : null,
      class_id: classId ?? null,
      active: true,
    });
  }
  const seen = new Map<string, number>();
  for (const [i, r] of records.entries()) {
    const key = normalizeAdmission(r.admission_no);
    if (seen.has(key)) problems.push(`Rows ${seen.get(key)! + 2} and ${i + 2}: same admission number ${r.admission_no}`);
    else seen.set(key, i);
  }
  if (problems.length) return fail(`Nothing was imported. Fix these first:\n${problems.slice(0, 20).join("\n")}${problems.length > 20 ? `\n…and ${problems.length - 20} more` : ""}`);
  const supabase = await createClient();
  const { error } = await supabase.from("students").upsert(records, { onConflict: "school_id,admission_key" });
  if (error) return fail(error);
  revalidatePath("/admin/students");
  const skippedText = [...skipped].map(([c, n]) => `${c} (${n})`).join(", ");
  return ok(
    `Imported ${records.length} students (existing admission numbers were updated).` +
      (skipped.size ? `\nSkipped — class not set up: ${skippedText}.` : ""),
  );
}

/** Lets the browser upload a (resized) photo straight to storage. */
export async function photoUploadUrl(studentId: string): Promise<{ url: string; path: string } | { error: string }> {
  try {
    await requireStudentManager();
  } catch (e) {
    return { error: (e as Error).message };
  }
  const supabase = await createClient();
  const { data: student } = await supabase.from("students").select("id").eq("id", studentId).maybeSingle();
  if (!student) return { error: "Student not found or not in your section." };
  const path = `${studentId}/${Date.now()}.jpg`;
  const { data, error } = await createAdminClient().storage.from(PHOTO_BUCKET).createSignedUploadUrl(path);
  if (error || !data) return { error: error?.message ?? "Could not prepare upload." };
  return { url: data.signedUrl, path };
}

export async function setPhotoPath(studentId: string, path: string): Promise<ActionResult> {
  try {
    await requireStudentManager();
  } catch (e) {
    return fail(e);
  }
  if (!path.startsWith(`${studentId}/`)) return fail("Invalid photo path.");
  const supabase = await createClient();
  const { data: old } = await supabase.from("students").select("photo_path").eq("id", studentId).maybeSingle();
  const { error } = await supabase.from("students").update({ photo_path: path }).eq("id", studentId);
  if (error) return fail(error);
  if (old?.photo_path && old.photo_path !== path) {
    await createAdminClient().storage.from(PHOTO_BUCKET).remove([old.photo_path]);
  }
  revalidatePath(`/admin/students/${studentId}`);
  return ok("Photo saved.");
}

export async function moveStudents(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    await requireStudentManager();
  } catch (e) {
    return fail(e);
  }
  const ids = fd.getAll("student_id").map(String);
  const target = str(fd, "target_class_id");
  if (!ids.length) return fail("Tick the students to move.");
  const supabase = await createClient();
  const patch = target === "__leave" ? { active: false } : { class_id: target || null };
  const { error } = await supabase.from("students").update(patch).in("id", ids);
  if (error) return fail(error);
  revalidatePath("/admin/students");
  return ok(target === "__leave" ? `Marked ${ids.length} as left.` : `Moved ${ids.length} students.`);
}
