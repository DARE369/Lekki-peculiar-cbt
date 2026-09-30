import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { ClassRow, Section, Subject, Term, Year } from "@/lib/types";

export interface Structure {
  sections: Section[];
  years: Year[];
  classes: ClassRow[];
  subjects: Subject[];
  terms: (Term & { session_name: string })[];
  currentTerm: (Term & { session_name: string }) | null;
  currentSessionId: string | null;
  sectionById: Map<string, Section>;
  yearById: Map<string, Year>;
  classById: Map<string, ClassRow>;
  subjectById: Map<string, Subject>;
  /** "Year 4 Gold" etc. with section for disambiguation where useful */
  className: (id: string | null | undefined) => string;
  sectionOfClass: (id: string) => Section | undefined;
}

/** School structure (small, read on most pages). Cached per request. */
export const getStructure = cache(async (): Promise<Structure> => {
  const supabase = await createClient();
  const [sections, years, classes, subjects, terms] = await Promise.all([
    supabase.from("sections").select("*").order("sort"),
    supabase.from("years").select("*").order("level"),
    supabase.from("classes").select("*").order("name"),
    supabase.from("subjects").select("*").order("name"),
    supabase.from("terms").select("*, academic_sessions(name, is_current)").order("ordinal"),
  ]);
  const sectionById = new Map((sections.data ?? []).map((s: Section) => [s.id, s]));
  const yearById = new Map((years.data ?? []).map((y: Year) => [y.id, y]));
  const classById = new Map((classes.data ?? []).map((c: ClassRow) => [c.id, c]));
  const subjectById = new Map((subjects.data ?? []).map((s: Subject) => [s.id, s]));
  type TermJoin = Term & { academic_sessions: { name: string; is_current: boolean } | null };
  const termRows = ((terms.data ?? []) as TermJoin[])
    .map(({ academic_sessions, ...t }) => ({ ...t, session_name: academic_sessions?.name ?? "" }))
    .sort((a, b) => b.session_name.localeCompare(a.session_name) || a.ordinal - b.ordinal);
  const currentTerm = termRows.find((t) => t.is_current) ?? null;
  // Sort classes by year level, then name.
  const classList = [...classById.values()].sort(
    (a, b) => (yearById.get(a.year_id)?.level ?? 0) - (yearById.get(b.year_id)?.level ?? 0) || a.name.localeCompare(b.name),
  );
  return {
    sections: sections.data ?? [],
    years: years.data ?? [],
    classes: classList,
    subjects: subjects.data ?? [],
    terms: termRows,
    currentTerm,
    currentSessionId: currentTerm?.session_id ?? null,
    sectionById,
    yearById,
    classById,
    subjectById,
    className: (id) => (id ? (classById.get(id)?.name ?? "—") : "—"),
    sectionOfClass: (id) => {
      const c = classById.get(id);
      const y = c ? yearById.get(c.year_id) : undefined;
      return y ? sectionById.get(y.section_id) : undefined;
    },
  };
});

export function fullName(s: { first_name: string; last_name: string; other_names?: string | null }) {
  return [s.first_name, s.other_names, s.last_name].filter(Boolean).join(" ");
}

export function formatDateTime(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-NG", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Africa/Lagos",
  }).format(new Date(iso));
}

export function pct(score: number | null | undefined, max: number | null | undefined) {
  if (score == null || !max) return null;
  return Math.round((Number(score) / Number(max)) * 1000) / 10;
}
