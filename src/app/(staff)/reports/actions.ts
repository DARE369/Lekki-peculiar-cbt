"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/auth";
import { fail, ok, str, type ActionResult } from "@/lib/actions";
import { createClient } from "@/lib/supabase/server";

export async function correctAnswerKey(_: ActionResult, fd: FormData): Promise<ActionResult> {
  await requireStaff();
  const assessmentId = str(fd, "assessment_id");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("correct_answer_key", {
    p_assessment: assessmentId,
    p_question: str(fd, "question_id"),
    p_answer: str(fd, "answer"),
  });
  if (error) return fail(error);
  revalidatePath(`/reports/assessment/${assessmentId}`);
  return ok(`Answer key corrected and ${data} script${data === 1 ? "" : "s"} regraded.`);
}
