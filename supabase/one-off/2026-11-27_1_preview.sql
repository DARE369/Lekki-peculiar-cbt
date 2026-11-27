-- ============================================================================================================
-- PREVIEW (read-only, changes nothing): what the move to First Term would touch. Run this first.
-- Run QUERY 1 on its own, then QUERY 2 on its own (the editor shows the result of the last query it runs).
-- ============================================================================================================

-- QUERY 1: the totals.
with cur as (select id, name from public.academic_sessions where is_current),
     t1 as (select t.id, t.name from public.terms t join cur on cur.id = t.session_id where t.ordinal = 1),
     t2 as (select t.id, t.name from public.terms t join cur on cur.id = t.session_id where t.ordinal = 2),
     other2 as (select t.id from public.terms t where t.ordinal = 2 and t.id <> (select id from t2))
select * from (
  select 10 as ord, 'Session' as item, (select name from cur) as value
  union all select 20, 'Moving FROM', (select name from t2)
  union all select 30, 'Moving TO', (select name from t1)
  union all select 40, 'Tests (their results, scores and exam windows follow them automatically)', count(*)::text from public.assessments where term_id = (select id from t2)
  union all select 50, '   of those, with students'' results', count(distinct a.assessment_id)::text from public.attempts a join public.assessments s on s.id = a.assessment_id where s.term_id = (select id from t2)
  union all select 60, '   student results that will follow', count(*)::text from public.attempts a join public.assessments s on s.id = a.assessment_id where s.term_id = (select id from t2)
  union all select 70, '   exam windows that will follow', count(*)::text from public.exam_windows w join public.assessments s on s.id = w.assessment_id where s.term_id = (select id from t2)
  union all select 80, 'Questions', count(*)::text from public.questions where term_id = (select id from t2)
  union all select 90, 'Question banks (uploads)', count(*)::text from public.question_uploads where term_id = (select id from t2)
  union all select 100, 'Exam calendar dates', count(*)::text from public.round_schedules where term_id = (select id from t2)
  union all select 110, '   of those, clashing with a date already in First Term (these stay put)',
         count(*)::text from public.round_schedules rs where rs.term_id = (select id from t2)
           and exists (select 1 from public.round_schedules f where f.term_id = (select id from t1) and f.round_id = rs.round_id and f.year_id = rs.year_id)
  union all select 120, 'Already in First Term (not touched)', count(*)::text from public.assessments where term_id = (select id from t1)
  union all select 130, 'Tests in EARLIER years'' Second Terms (never touched)', count(*)::text from public.assessments where term_id in (select id from other2)
  union all select 140, 'Already moved before? (should be none)',
         case when to_regclass('public.term_move_log') is null then 'No'
              else coalesce((xpath('/row/c/text()', query_to_xml('select count(*) as c from public.term_move_log where batch like ''second-to-first:%'' and undone_at is null', false, true, '')))[1]::text, '0') || ' earlier move(s) on record' end
) q order by ord;

-- QUERY 2: the tests that would move, so you can see they are the right ones.
select s.title,
       sub.name as subject,
       y.name as year_group,
       s.status,
       s.created_at::date as created,
       (select count(*) from public.attempts a where a.assessment_id = s.id) as student_results
from public.assessments s
join public.subjects sub on sub.id = s.subject_id
join public.years y on y.id = s.year_id
where s.term_id = (select t.id from public.terms t join public.academic_sessions a on a.id = t.session_id where a.is_current and t.ordinal = 2)
order by s.created_at;
