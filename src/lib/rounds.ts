// Rounds (1st CA, 2nd CA, Mid-Term, Exam…) organise both questions and papers. One small set of helpers
// so every screen agrees on a round's kind, defaults and which sections it applies to.
import type { RoundConfig } from "@/lib/data";
import { TYPE_DEFAULTS, type AssessmentType } from "@/lib/types";

export type Round = RoundConfig;

export function roundKind(r: Pick<Round, "kind" | "label">): "test" | "exam" {
  return r.kind ?? (/\bexam\b/i.test(r.label) ? "exam" : "test");
}

/** The assessment type a paper in this round gets. Rounds that don't count are mocks. */
export function roundType(r: Pick<Round, "kind" | "label" | "counts_to_result">): AssessmentType {
  const kind = roundKind(r);
  if (r.counts_to_result === false) return kind === "exam" ? "mock" : "mock_test";
  return kind;
}

export function roundDefaults(r: Round) {
  const t = TYPE_DEFAULTS[roundType(r)];
  return { type: roundType(r), questions: r.question_count ?? t.questions, minutes: r.duration_minutes ?? t.minutes };
}

/** Active rounds that apply to a section, in order. */
export function roundsForSection(rounds: Round[], sectionId: string | null | undefined, includeHidden = false) {
  return rounds
    .filter((r) => (includeHidden || r.is_active) && (!r.section_ids?.length || (sectionId ? r.section_ids.includes(sectionId) : true)))
    .sort((a, b) => a.sort_order - b.sort_order);
}

/** A paper's round: its round_id, or (for papers made before rounds were stored) its round label. */
export function roundOf(a: { round_id?: string | null; sequence_label?: string | null }, rounds: Round[]): Round | null {
  if (a.round_id) return rounds.find((r) => r.id === a.round_id) ?? null;
  if (a.sequence_label) return rounds.find((r) => r.label.toLowerCase() === a.sequence_label!.toLowerCase()) ?? null;
  return null;
}

/** Who may change a round: super admins any; Heads of Section only rounds limited to their own sections. */
export function canManageRound(staff: { isSuperAdmin: boolean; isAdmin: boolean; sectionIds: string[] }, r: Pick<Round, "section_ids">) {
  if (staff.isSuperAdmin) return true;
  if (!staff.isAdmin) return false;
  const secs = r.section_ids ?? [];
  return secs.length > 0 && secs.every((s) => staff.sectionIds.includes(s));
}
