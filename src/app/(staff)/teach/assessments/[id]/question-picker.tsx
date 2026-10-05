"use client";

import { ActionForm, SubmitButton } from "@/components/forms";
import { Table, Td, Th } from "@/components/ui";
import { addQuestionsToAssessment, addAllBankQuestions, autoFillAssessment } from "../../actions";

type BankQ = { id: string; body: string; topic: string | null };

function handleSelectAll(e: React.ChangeEvent<HTMLInputElement>) {
  const form = e.target.closest("form");
  form?.querySelectorAll<HTMLInputElement>('input[name="question_id"]').forEach((cb) => {
    cb.checked = e.target.checked;
  });
}

export function QuestionPicker({
  assessmentId,
  bank,
  needed,
}: {
  assessmentId: string;
  bank: BankQ[];
  needed: number;
}) {
  return (
    <div className="space-y-0">
      {/* Manual selection with select-all */}
      <ActionForm action={addQuestionsToAssessment} hideSuccess>
        <input type="hidden" name="assessment_id" value={assessmentId} />
        <div className="max-h-[440px] overflow-y-auto">
          <Table stack>
            <thead className="sticky top-0 z-10">
              <tr>
                <Th className="w-10">
                  <input
                    type="checkbox"
                    onChange={handleSelectAll}
                    className="h-4 w-4 accent-[var(--brand)]"
                    aria-label="Select all"
                    title="Select all"
                  />
                </Th>
                <Th>Question</Th>
                <Th>Topic</Th>
              </tr>
            </thead>
            <tbody>
              {bank.map((q) => (
                <tr key={q.id}>
                  <Td className="cell-check">
                    <input
                      type="checkbox"
                      name="question_id"
                      value={q.id}
                      className="h-4 w-4 accent-[var(--brand)]"
                      aria-label="Select"
                    />
                  </Td>
                  <Td className="line-clamp-2">{q.body}</Td>
                  <Td label="Topic" className="text-xs">{q.topic ?? "—"}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
        <div className="flex items-center justify-between border-t border-border px-4 py-3">
          <p className="text-xs text-muted">Tick the ones you want, then click Add.</p>
          <SubmitButton size="sm">Add ticked</SubmitButton>
        </div>
      </ActionForm>

      {/* Quick alternatives */}
      <div className="border-t border-border bg-surface-2 px-4 py-3 space-y-2 rounded-b-xl">
        <p className="text-xs font-semibold text-muted uppercase tracking-wide">Quick options</p>
        <div className="flex flex-wrap gap-2">
          <ActionForm action={addAllBankQuestions} hideSuccess className="contents">
            <input type="hidden" name="assessment_id" value={assessmentId} />
            <SubmitButton size="sm" variant="secondary">
              Add all {bank.length} questions
            </SubmitButton>
          </ActionForm>
          {needed > 0 ? (
            <ActionForm action={autoFillAssessment} hideSuccess className="contents">
              <input type="hidden" name="assessment_id" value={assessmentId} />
              <SubmitButton size="sm" variant="secondary">
                Auto-fill {needed} randomly
              </SubmitButton>
            </ActionForm>
          ) : null}
        </div>
      </div>
    </div>
  );
}
