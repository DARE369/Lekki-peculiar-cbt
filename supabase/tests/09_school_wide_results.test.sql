-- School-wide "results for students": it beats each test's own setting, only the super admin can set it. Rolled back.
begin;
create or replace function pg_temp.act_as(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(uid::text, ''), true);
  if uid is null then execute 'set local role service_role'; else execute 'set local role authenticated'; end if;
end $$;
create or replace function pg_temp.expect_error(sql text, fragment text) returns void language plpgsql as $$
begin
  execute sql;
  raise exception 'expected error containing "%" but statement succeeded: %', fragment, sql;
exception when others then
  if position(fragment in sqlerrm) = 0 then raise exception 'expected error containing "%" but got "%"', fragment, sqlerrm; end if;
end $$;
create temp table ids (k text primary key, v uuid);
grant all on ids to authenticated, service_role;
do $$
declare
  sch uuid := (select id from public.schools limit 1);
  elem uuid := (select id from public.sections where code = 'ELEM');
  y4 uuid := (select id from public.years where section_id = elem and level = 4);
  bio uuid := (select id from public.subjects where section_id = elem and name = 'Basic Science');
  term uuid := (select id from public.terms where is_current);
  boss uuid := gen_random_uuid(); hod uuid := gen_random_uuid(); teacher uuid := gen_random_uuid();
  cls uuid; stu uuid; a_none uuid; a_full uuid; w1 uuid; w2 uuid; t1 uuid; t2 uuid;
begin
  insert into auth.users (id, email) values (boss, 'b9@lps.test'), (hod, 'h9@lps.test'), (teacher, 't9@lps.test');
  insert into public.staff (id, school_id, email, full_name, role) values
    (boss, sch, 'b9@lps.test', 'Boss', 'super_admin'), (hod, sch, 'h9@lps.test', 'HOD', 'admin'), (teacher, sch, 't9@lps.test', 'Teacher', 'teacher');
  insert into public.admin_sections values (hod, elem);
  insert into public.classes (year_id, name) values (y4, 'Year 4 Policy') returning id into cls;
  insert into public.students (school_id, admission_no, first_name, last_name, class_id) values (sch, 'P9/1', 'Pol', 'One', cls) returning id into stu;
  -- one test that hides results itself, one that shows corrections
  insert into public.assessments (subject_id, year_id, term_id, title, type, question_count, duration_minutes, created_by, status, paper, settings)
  values (bio, y4, term, 'Hides itself', 'test', 1, 20, teacher, 'approved', '{"questions":[]}', '{"show_result":"none"}') returning id into a_none;
  insert into public.assessments (subject_id, year_id, term_id, title, type, question_count, duration_minutes, created_by, status, paper, settings)
  values (bio, y4, term, 'Shows corrections', 'test', 1, 20, teacher, 'approved', '{"questions":[]}', '{"show_result":"full"}') returning id into a_full;
  insert into public.exam_windows (assessment_id, class_id, starts_at, ends_at, status) values (a_none, cls, now() - interval '2 hours', now() - interval '1 hour', 'closed') returning id into w1;
  insert into public.exam_windows (assessment_id, class_id, starts_at, ends_at, status) values (a_full, cls, now() - interval '2 hours', now() - interval '1 hour', 'closed') returning id into w2;
  insert into public.attempts (window_id, assessment_id, student_id, class_id, status, question_order, deadline, submitted_at, total_questions, score, max_score)
  values (w1, a_none, stu, cls, 'submitted', '[]', now(), now(), 1, 1, 1) returning id into t1;
  insert into public.attempts (window_id, assessment_id, student_id, class_id, status, question_order, deadline, submitted_at, total_questions, score, max_score)
  values (w2, a_full, stu, cls, 'submitted', '[]', now(), now(), 1, 1, 1) returning id into t2;
  insert into ids values ('boss', boss), ('hod', hod), ('teacher', teacher), ('t1', t1), ('t2', t2);
end $$;

-- Nothing set: each test decides.
do $$ begin
  if public._exam_result((select v from ids where k = 't1')) ->> 'show' <> 'none' then raise exception 'default: hiding test should hide'; end if;
  if public._exam_result((select v from ids where k = 't2')) ->> 'show' <> 'full' then raise exception 'default: corrections test should show corrections'; end if;
end $$;

-- Only the super admin can change it.
select pg_temp.act_as((select v from ids where k = 'hod'));
select pg_temp.expect_error($q$ select public.set_school_results_override('hide') $q$, 'permission denied');
select pg_temp.act_as((select v from ids where k = 'teacher'));
select pg_temp.expect_error($q$ select public.set_school_results_override('hide') $q$, 'permission denied');
select pg_temp.act_as((select v from ids where k = 'boss'));
select pg_temp.expect_error($q$ select public.set_school_results_override('nonsense') $q$, 'choose hide, show or each');

-- Hide for everyone: even the test set to show corrections shows nothing, and no score is sent.
select public.set_school_results_override('hide');
select pg_temp.act_as(null);
do $$ declare r jsonb; begin
  r := public._exam_result((select v from ids where k = 't2'));
  if r ->> 'show' <> 'none' or r ? 'score' then raise exception 'hide-all still showed results: %', r; end if;
end $$;

-- Show for everyone: the test that hides itself now shows the score; the corrections test keeps its corrections.
select pg_temp.act_as((select v from ids where k = 'boss'));
select public.set_school_results_override('show');
select pg_temp.act_as(null);
do $$ begin
  if public._exam_result((select v from ids where k = 't1')) ->> 'show' <> 'score' then raise exception 'show-all did not show the score'; end if;
  if public._exam_result((select v from ids where k = 't2')) ->> 'show' <> 'full' then raise exception 'show-all dropped corrections'; end if;
end $$;

-- Back to each test deciding; the tests' own settings were never touched.
select pg_temp.act_as((select v from ids where k = 'boss'));
select public.set_school_results_override('each');
select pg_temp.act_as(null);
do $$ begin
  if (select results_override from public.schools limit 1) is not null then raise exception 'override not cleared'; end if;
  if public._exam_result((select v from ids where k = 't1')) ->> 'show' <> 'none' then raise exception 'own setting lost'; end if;
  if (select settings ->> 'show_result' from public.assessments where title = 'Hides itself') <> 'none' then raise exception 'test settings were changed'; end if;
end $$;
rollback;
