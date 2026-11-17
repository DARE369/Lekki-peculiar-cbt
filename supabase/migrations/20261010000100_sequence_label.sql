-- Add an optional short label that lets staff group assessments as e.g.
-- "Test 1", "Test 2", "1st CA", "Exam" within a term.
-- The label is purely cosmetic: it does not affect questions, attempts, or scoring.

alter table public.assessments
  add column sequence_label text
    check (
      sequence_label is null or (
        length(trim(sequence_label)) > 0 and
        length(sequence_label) <= 30
      )
    );

comment on column public.assessments.sequence_label is
  'Optional short label grouping assessments within a term, e.g. "Test 1", "Exam", "1st CA". Max 30 chars. No effect on questions or scores.';
