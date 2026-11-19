-- Marks: a test is either "each question is worth N marks" (halves allowed) or "the whole test is out of N".
-- Banks: named sets of questions can also be made by hand, not only by uploading.
--
-- ADDITIVE ONLY. Results already given are never recalculated by this migration; the new rule applies the
-- next time an attempt is graded (when it is submitted, or when a teacher fixes an answer key).

-- assessments.settings gains (no column change — it's JSON):
--   marks_mode: 'per_question' (default) | 'total'
--   marks_per_question: number, e.g. 1, 2, 0.5
--   total_marks: number, e.g. 20 (used when marks_mode = 'total')
create or replace function public.grade_attempt(p_attempt uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  t public.attempts;
  a public.assessments;
  marks numeric;
  total numeric;
  n_answered int;
  n_correct int;
  n_total int;
begin
  select * into t from public.attempts where id = p_attempt;
  if not found or t.status = 'in_progress' then return; end if;
  select * into a from public.assessments where id = t.assessment_id;
  marks := greatest(coalesce(nullif(a.settings ->> 'marks_per_question', '')::numeric, 1), 0.1);
  total := case when a.settings ->> 'marks_mode' = 'total'
                then nullif(a.settings ->> 'total_marks', '')::numeric end;

  with ord as (
    select x ->> 'q' as qid from jsonb_array_elements(t.question_order) x
  ), keyed as (
    select e ->> 'id' as qid, e ->> 'answer' as ans from jsonb_array_elements(a.paper -> 'questions') e
  )
  select count(*),
         count(*) filter (where aa.selected is not null),
         count(*) filter (where aa.selected = keyed.ans)
    into n_total, n_answered, n_correct
  from ord
  join keyed using (qid)
  left join public.attempt_answers aa on aa.attempt_id = t.id and aa.question_id::text = ord.qid;

  update public.attempts
     set total_questions = n_total,
         answered_count = n_answered,
         correct_count = n_correct,
         -- "Out of 20": the share of questions right, scaled to 20, to one decimal place.
         score = case when total is not null and total > 0
                      then round(case when n_total > 0 then n_correct::numeric / n_total * total else 0 end, 1)
                      else round(n_correct * marks, 1) end,
         max_score = case when total is not null and total > 0 then round(total, 1) else round(n_total * marks, 1) end
   where id = t.id;
end $$;
revoke execute on function public.grade_attempt(uuid) from authenticated;

-- Banks made by hand ("Add to bank") and banks named from older questions grouped by their upload.
alter table public.question_uploads drop constraint if exists question_uploads_source_format_check;
alter table public.question_uploads add constraint question_uploads_source_format_check
  check (source_format is null or source_format in ('paste', 'word', 'excel', 'csv', 'json', 'text', 'manual', 'earlier'));
