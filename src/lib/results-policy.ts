import "server-only";
import { createClient } from "@/lib/supabase/server";

export type ResultsOverride = "hide" | "show" | null;

/** The school-wide choice about showing results to students (null: each test decides). */
export async function getResultsOverride(): Promise<ResultsOverride> {
  const { data } = await (await createClient()).from("schools").select("results_override").maybeSingle();
  const v = (data as { results_override?: string | null } | null)?.results_override;
  return v === "hide" || v === "show" ? v : null;
}
