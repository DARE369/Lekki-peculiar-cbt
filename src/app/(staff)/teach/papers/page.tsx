import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Badge, Card, EmptyState, LinkButton, PageHeader, Table, Td, Th } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { getRoundConfigs, getStructure } from "@/lib/data";
import { STATUS_LABEL } from "@/lib/labels";
import { getUploadProgress } from "@/lib/onboarding";
import { roundOf, roundsForSection } from "@/lib/rounds";
import { createClient } from "@/lib/supabase/server";
import type { AssessmentStatus } from "@/lib/types";
import { openPaperForRound } from "../actions";

export const metadata: Metadata = { title: "This term's papers" };

type Paper = {
  id: string;
  title: string;
  status: AssessmentStatus;
  subject_id: string;
  year_id: string;
  round_id: string | null;
  sequence_label: string | null;
  question_count: number;
  class_ids: string[];
  created_by: string;
  flag_status: string | null;
  amending: boolean;
};

/**
 * Every paper a teacher owes this term, in one place: their subjects and year groups down the side,
 * the school's rounds across the top. One click opens the paper (or creates it with the round's settings).
 */
export default async function PapersPage() {
  const staff = await requireStaff();
  const s = await getStructure();
  const [rows, rounds] = await Promise.all([getUploadProgress(s, staff.id), getRoundConfigs()]);
  const supabase = await createClient();
  const termId = s.currentTerm?.id ?? "";
  const subjectIds = [...new Set(rows.map((r) => r.subjectId))];

  const { data: paperRows } = subjectIds.length
    ? await supabase
        .from("assessments")
        .select("id, title, status, subject_id, year_id, round_id, sequence_label, question_count, class_ids, created_by, flag_status, amending")
        .eq("term_id", termId)
        .in("subject_id", subjectIds)
    : { data: [] };
  const papers = (paperRows ?? []) as Paper[];
  const counts = new Map<string, number>();
  if (papers.length) {
    const { data: links } = await supabase.from("assessment_questions").select("assessment_id").in("assessment_id", papers.map((p) => p.id));
    for (const l of links ?? []) counts.set(l.assessment_id as string, (counts.get(l.assessment_id as string) ?? 0) + 1);
  }
  // Questions already uploaded for each subject, year group and round (the teacher's own).
  const qCounts = new Map<string, number>();
  if (subjectIds.length) {
    for (let from = 0; ; from += 1000) {
      const { data } = await supabase
        .from("questions")
        .select("subject_id, year_id, round_id")
        .eq("owner_id", staff.id)
        .in("subject_id", subjectIds)
        .eq("archived", false)
        .not("round_id", "is", null)
        .range(from, from + 999);
      for (const q of data ?? []) {
        const k = `${q.subject_id}:${q.year_id ?? "*"}:${q.round_id}`;
        qCounts.set(k, (qCounts.get(k) ?? 0) + 1);
      }
      if (!data || data.length < 1000) break;
    }
  }

  // Columns: the rounds used by any of the teacher's sections.
  const sectionIds = [...new Set(rows.map((r) => s.subjectById.get(r.subjectId)?.section_id).filter(Boolean))] as string[];
  const columns = rounds.filter((r) => r.is_active && sectionIds.some((sec) => roundsForSection([r], sec).length));

  return (
    <div className="space-y-6">
      <PageHeader
        title="This term's papers"
        description={`${s.currentTerm ? `${s.currentTerm.session_name} · ${s.currentTerm.name}. ` : ""}Each subject and year group has one paper per round. Open a paper to add questions and send it for review.`}
        actions={<LinkButton href="/teach/questions/import" variant="secondary">Upload questions</LinkButton>}
      />

      {rows.length === 0 ? (
        <Card>
          <EmptyState title="No subjects yet" action={<LinkButton href="/teach/classes">Choose what you teach</LinkButton>}>
            Pick the subjects and classes you teach. Your papers for each round then appear here.
          </EmptyState>
        </Card>
      ) : columns.length === 0 ? (
        <Card>
          <EmptyState title="No rounds set up yet">Ask your Head of Section to add this term&apos;s rounds (1st CA, Exam…).</EmptyState>
        </Card>
      ) : (
        <Card>
          <Table stack>
            <thead>
              <tr>
                <Th>Subject</Th>
                {columns.map((r) => (
                  <Th key={r.id}>{r.label}</Th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const sec = s.subjectById.get(row.subjectId)?.section_id;
                return (
                  <tr key={`${row.subjectId}:${row.yearId}`}>
                    <Td>
                      <p className="font-medium">{s.subjectById.get(row.subjectId)?.name}</p>
                      <p className="text-xs text-muted">
                        {s.yearById.get(row.yearId)?.name}
                        {row.approved ? "" : " · waiting for approval"}
                      </p>
                    </Td>
                    {columns.map((round) => {
                      if (!roundsForSection([round], sec).length) {
                        return (
                          <Td key={round.id} label={round.label} className="text-subtle">
                            —
                          </Td>
                        );
                      }
                      const here = papers.filter(
                        (p) => p.subject_id === row.subjectId && p.year_id === row.yearId && roundOf(p, rounds)?.id === round.id,
                      );
                      const paper = here.find((p) => p.created_by === staff.id) ?? here.find((p) => p.class_ids.some((c) => row.classIds.includes(c))) ?? here[0];
                      const uploaded = (qCounts.get(`${row.subjectId}:${row.yearId}:${round.id}`) ?? 0) + (qCounts.get(`${row.subjectId}:*:${round.id}`) ?? 0);
                      return (
                        <Td key={round.id} label={round.label} className="align-top">
                          {paper ? (
                            <PaperCell paper={paper} have={counts.get(paper.id) ?? 0} />
                          ) : row.approved ? (
                            <ActionForm action={openPaperForRound}>
                              <input type="hidden" name="subject_id" value={row.subjectId} />
                              <input type="hidden" name="year_id" value={row.yearId} />
                              <input type="hidden" name="round_id" value={round.id} />
                              <SubmitButton size="sm" variant="secondary" pendingText="Opening…">
                                Start paper
                              </SubmitButton>
                              {uploaded ? <p className="mt-1 text-xs text-muted">{uploaded} questions uploaded</p> : null}
                            </ActionForm>
                          ) : (
                            <div className="text-sm">
                              <Link
                                href={`/teach/questions/import?subject=${row.subjectId}&year=${row.yearId}&round=${round.id}`}
                                className="font-medium text-brand hover:underline"
                              >
                                Upload questions
                              </Link>
                              <p className="mt-0.5 text-xs text-muted">{uploaded ? `${uploaded} uploaded` : "Not started"}</p>
                            </div>
                          )}
                        </Td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </Card>
      )}
    </div>
  );
}

function PaperCell({ paper, have }: { paper: Paper; have: number }) {
  const [label, tone] = paper.flag_status === "open" ? (["Needs changes", "danger"] as const) : STATUS_LABEL[paper.status];
  const short = have < paper.question_count && (paper.status === "draft" || paper.status === "changes_requested");
  return (
    <Link href={`/teach/assessments/${paper.id}`} className="group block text-sm">
      <Badge tone={tone}>{label}</Badge>
      <span className={`mt-1 block text-xs ${short ? "text-warning" : "text-muted"} group-hover:text-text`}>
        {have} of {paper.question_count} questions
      </span>
    </Link>
  );
}
