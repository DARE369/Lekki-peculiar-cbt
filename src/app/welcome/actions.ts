"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/auth";
import { fail, str, type ActionResult } from "@/lib/actions";
import { getStructure } from "@/lib/data";
import { normalisePhone } from "@/lib/phone";
import { createAdminClient, createClient } from "@/lib/supabase/server";

export async function saveAbout(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const me = await requireStaff();
  const fullName = str(fd, "full_name").replace(/\s+/g, " ");
  const phone = normalisePhone(str(fd, "phone"));
  if (fullName.length < 3) return fail("Please type your full name.");
  if (!phone) return fail("Please type a phone number we can reach you on, e.g. 0803 123 4567.");
  // Staff can't edit their own row under RLS (only super admins can), so this narrow update runs server-side.
  const { error } = await createAdminClient().from("staff").update({ full_name: fullName, phone }).eq("id", me.id);
  if (error) return fail(error);
  redirect(`/welcome?step=${str(fd, "next")}`);
}

export async function savePassword(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const me = await requireStaff();
  const password = str(fd, "password");
  if (password.length < 8) return fail("Use at least 8 characters.");
  if (password !== str(fd, "confirm")) return fail("The two passwords are not the same. Please type them again.");
  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password });
  if (error && !/same|different from the old/i.test(error.message)) return fail(error.message);
  await createAdminClient().from("staff").update({ needs_password: false }).eq("id", me.id);
  redirect(`/welcome?step=${str(fd, "next")}`);
}

/** Saves the subject/class choices. Pending choices that were unticked are withdrawn; approved ones stay. */
export async function saveSubjects(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const me = await requireStaff();
  const s = await getStructure();
  if (!s.currentSessionId) return fail("The school year hasn't been set up yet. Please contact the school office.");
  const picks = new Set(fd.getAll("pick").map(String));
  const rows: { subject_id: string; class_id: string }[] = [];
  for (const p of picks) {
    const [subjectId, classId] = p.split(":");
    const subject = s.subjectById.get(subjectId);
    if (!subject || !s.classById.has(classId) || s.sectionOfClass(classId)?.id !== subject.section_id) continue;
    rows.push({ subject_id: subjectId, class_id: classId });
  }
  const supabase = await createClient();
  const { data: existing } = await supabase
    .from("teaching_assignments")
    .select("id, subject_id, class_id, status")
    .eq("teacher_id", me.id)
    .eq("session_id", s.currentSessionId);
  const withdraw = (existing ?? []).filter((r) => r.status === "requested" && !picks.has(`${r.subject_id}:${r.class_id}`)).map((r) => r.id);
  if (withdraw.length) await supabase.from("teaching_assignments").delete().in("id", withdraw);
  if (rows.length) {
    const { error } = await supabase.from("teaching_assignments").upsert(
      rows.map((r) => ({ ...r, teacher_id: me.id, session_id: s.currentSessionId, status: "requested" })),
      { onConflict: "teacher_id,subject_id,class_id,session_id", ignoreDuplicates: true },
    );
    if (error) return fail(error);
  }
  revalidatePath("/teach/classes");
  redirect(`/welcome?step=${str(fd, "next")}`);
}

export async function finishOnboarding(fd: FormData) {
  const me = await requireStaff();
  await createAdminClient().from("staff").update({ onboarded_at: new Date().toISOString() }).eq("id", me.id);
  revalidatePath("/", "layout");
  const to = str(fd, "to");
  redirect(to.startsWith("/") && !to.startsWith("//") ? to : "/dashboard");
}
