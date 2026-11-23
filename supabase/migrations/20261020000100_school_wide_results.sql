-- A school-wide switch for what students see after submitting. When set it beats each test's own choice:
--   'hide'  every student sees only a congratulations message
--   'show'  every student sees at least their score (a test set to show corrections still shows them)
--   null    each test decides (as before)
--
-- ADDITIVE ONLY: one new nullable column (null = nothing changes), one new function, and the result function
-- is replaced with the same signature plus the school-wide check. No existing row is changed.
alter table public.schools add column if not exists results_override text check (results_override in ('hide', 'show'));

create or replace function public._exam_result(p_attempt uuid)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  t public.attempts;
  a public.assessments;
  mode text;
  override text;
  review jsonb;
begin
  select * into t from public.attempts where id = p_attempt;
  select * into a from public.assessments where id = t.assessment_id;
  mode := coalesce(a.settings ->> 'show_result', 'score');
  -- A school-wide choice beats the test's own: hide it from everyone, or make sure everyone sees at least their score.
  select sc.results_override into override
    from public.subjects sj
    join public.sections sec on sec.id = sj.section_id
    join public.schools sc on sc.id = sec.school_id
   where sj.id = a.subject_id;
  if override = 'hide' then mode := 'none';
  elsif override = 'show' and mode = 'none' then mode := 'score';
  end if;
  if mode = 'none' or t.status <> 'submitted' then
    return jsonb_build_object('status', t.status, 'show', 'none');
  end if;
  if mode = 'full' then
    select jsonb_agg(jsonb_build_object(
             'q', x.ord ->> 'q',
             's', aa.selected,
             'a', (select e ->> 'answer' from jsonb_array_elements(a.paper -> 'questions') e where e ->> 'id' = x.ord ->> 'q'))
           order by x.oi)
      into review
    from jsonb_array_elements(t.question_order) with ordinality x(ord, oi)
    left join public.attempt_answers aa on aa.attempt_id = t.id and aa.question_id::text = x.ord ->> 'q';
  end if;
  return jsonb_build_object(
    'status', t.status, 'show', mode,
    'score', t.score, 'max_score', t.max_score,
    'correct', t.correct_count, 'answered', t.answered_count, 'total', t.total_questions,
    'review', review);
end $$;

create or replace function public.set_school_results_override(p_mode text)
returns text
language plpgsql security definer set search_path = public
as $$
begin
  perform public._require(public.is_super_admin(), 'permission denied');
  perform public._require(p_mode in ('hide', 'show', 'each'), 'choose hide, show or each');
  update public.schools set results_override = case when p_mode = 'each' then null else p_mode end
   where id = public.my_school_id();
  perform public.log_audit('results.school_wide', 'school', public.my_school_id()::text, jsonb_build_object('mode', p_mode));
  return p_mode;
end $$;
grant execute on function public.set_school_results_override(text) to authenticated;
