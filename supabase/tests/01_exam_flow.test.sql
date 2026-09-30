-- End-to-end database test: structure → staff → questions → approval → exam → grading,
-- plus the security rules (RLS, immutability, device lock, make-ups, key correction).
-- Runs inside a transaction that is rolled back.
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
  if position(fragment in sqlerrm) = 0 then
    raise exception 'expected error containing "%" but got "%"', fragment, sqlerrm;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Fixtures (as the table owner)
-- ---------------------------------------------------------------------------
create temp table ids (k text primary key, v uuid);
grant all on ids to authenticated, service_role;

do $$
declare
  sch uuid := (select id from public.schools limit 1);
  elem uuid := (select id from public.sections where code = 'ELEM');
  coll uuid := (select id from public.sections where code = 'COLL');
  y4 uuid := (select id from public.years where section_id = elem and level = 4);
  y10 uuid := (select id from public.years where section_id = coll and level = 10);
  sess uuid := (select id from public.academic_sessions where is_current);
  c4a uuid; c4b uuid; c10 uuid;
  sup uuid := gen_random_uuid(); hod uuid := gen_random_uuid(); chod uuid := gen_random_uuid();
  dixon uuid := gen_random_uuid(); other uuid := gen_random_uuid();
begin
  insert into auth.users (id, email) values
    (sup, 'owner@lps.test'), (hod, 'elem.hod@lps.test'), (chod, 'coll.hod@lps.test'),
    (dixon, 'dixon@lps.test'), (other, 'other@lps.test');
  insert into public.staff (id, school_id, email, full_name, role) values
    (sup, sch, 'owner@lps.test', 'Owner', 'super_admin'),
    (hod, sch, 'elem.hod@lps.test', 'Elementary HOD', 'admin'),
    (chod, sch, 'coll.hod@lps.test', 'College HOD', 'admin'),
    (dixon, sch, 'dixon@lps.test', 'Mr Dixon', 'teacher'),
    (other, sch, 'other@lps.test', 'Mrs Other', 'teacher');
  insert into public.admin_sections values (hod, elem), (chod, coll);
  insert into public.staff_permissions (staff_id, permission) values
    (hod, 'exam.approve'), (hod, 'exam.start'), (hod, 'students.manage'), (hod, 'teachers.manage'),
    (hod, 'attempt.unlock'), (hod, 'exam.extend_time');
  -- NB: hod deliberately lacks exam.grant_makeup and attempt.void.

  insert into public.classes (year_id, name) values (y4, 'Year 4 Gold') returning id into c4a;
  insert into public.classes (year_id, name) values (y4, 'Year 4 Blue') returning id into c4b;
  insert into public.classes (year_id, name) values (y10, 'Year 10 Science') returning id into c10;

  insert into ids values ('sch', sch), ('elem', elem), ('coll', coll), ('y4', y4), ('sess', sess),
    ('c4a', c4a), ('c4b', c4b), ('c10', c10), ('sup', sup), ('hod', hod), ('chod', chod),
    ('dixon', dixon), ('other', other),
    ('bio', (select id from public.subjects where section_id = elem and name = 'Basic Science')),
    ('term', (select id from public.terms where is_current));
end $$;

-- ---------------------------------------------------------------------------
-- Students: HOD creates them; admission numbers are matched loosely.
-- ---------------------------------------------------------------------------
select pg_temp.act_as((select v from ids where k = 'hod'));
insert into public.students (school_id, admission_no, first_name, last_name, class_id)
select (select v from ids where k = 'sch'), x.adm, x.fn, x.ln, (select v from ids where k = x.cls)
from (values ('LPS/2024/0137', 'Charles', 'Okafor', 'c4a'),
             ('LPS/2024/0138', 'Amaka', 'Bello', 'c4a'),
             ('LPS/2024/0200', 'Tunde', 'Adeyemi', 'c4b')) x(adm, fn, ln, cls);

-- College HOD cannot touch Elementary students.
select pg_temp.act_as((select v from ids where k = 'chod'));
do $$ begin
  if (select count(*) from public.students) <> 0 then raise exception 'college HOD sees elementary students'; end if;
end $$;

reset role;
do $$ begin
  if (select admission_key from public.students where first_name = 'Charles') <> 'LPS2024137' then
    raise exception 'admission normalisation failed';
  end if;
  if (select count(*) from public.exam_lookup_admission((select v from ids where k = 'sch'), 'lps 2024 137')) <> 1 then
    raise exception 'exact lookup failed';
  end if;
  if not exists (select 1 from public.exam_lookup_admission((select v from ids where k = 'sch'), 'LPS/2024/0173')
                 where not exact) then
    raise exception 'typo lookup returned nothing';
  end if;
  if (select count(*) from public.exam_search_names((select v from ids where k = 'c4a'), 'charls')) < 1 then
    raise exception 'fuzzy name search failed';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Teaching assignments: Dixon requests, HOD approves.
-- ---------------------------------------------------------------------------
select pg_temp.act_as((select v from ids where k = 'dixon'));
insert into public.teaching_assignments (teacher_id, subject_id, class_id, session_id)
values ((select v from ids where k = 'dixon'), (select v from ids where k = 'bio'),
        (select v from ids where k = 'c4a'), (select v from ids where k = 'sess'));
select pg_temp.expect_error($q$
  insert into public.teaching_assignments (teacher_id, subject_id, class_id, session_id, status)
  values ((select v from ids where k = 'dixon'), (select v from ids where k = 'bio'),
          (select v from ids where k = 'c4b'), (select v from ids where k = 'sess'), 'approved')
$q$, 'row-level security');
do $$ begin
  if (select count(*) from public.students) <> 0 then raise exception 'unapproved teacher sees students'; end if;
end $$;

select pg_temp.act_as((select v from ids where k = 'hod'));
select public.decide_assignment((select id from public.teaching_assignments limit 1), true);

select pg_temp.act_as((select v from ids where k = 'dixon'));
do $$ begin
  if (select count(*) from public.students) <> 2 then raise exception 'Dixon should see exactly his 2 students'; end if;
end $$;

-- ---------------------------------------------------------------------------
-- Question bank + assessment
-- ---------------------------------------------------------------------------
insert into public.questions (subject_id, owner_id, body, options, answer)
select (select v from ids where k = 'bio'), (select v from ids where k = 'dixon'),
       'Question ' || g,
       '[{"key":"A","text":"one"},{"key":"B","text":"two"},{"key":"C","text":"three"},{"key":"D","text":"four"}]'::jsonb,
       'B'
from generate_series(1, 6) g;

insert into public.assessments (subject_id, year_id, term_id, title, type, question_count, duration_minutes, created_by, settings)
values ((select v from ids where k = 'bio'), (select v from ids where k = 'y4'), (select v from ids where k = 'term'),
        'Basic Science Test 1', 'test', 5, 20, (select v from ids where k = 'dixon'),
        '{"shuffle_questions":true,"shuffle_options":true,"require_all_answered":true,"show_result":"score"}');
insert into ids values ('asmt', (select id from public.assessments limit 1));
insert into public.assessment_questions (assessment_id, question_id, position)
select (select v from ids where k = 'asmt'), id, row_number() over (order by body) from public.questions;

-- Teachers cannot approve their own work or jump status.
select pg_temp.expect_error($q$
  update public.assessments set status = 'approved' where id = (select v from ids where k = 'asmt')
$q$, 'row-level security');
select public.submit_assessment((select v from ids where k = 'asmt'));
select pg_temp.expect_error($q$
  select public.review_assessment((select v from ids where k = 'asmt'), true, null)
$q$, 'permission');

-- Other teacher cannot see it.
select pg_temp.act_as((select v from ids where k = 'other'));
do $$ begin
  if exists (select 1 from public.assessments) then raise exception 'other teacher sees assessment'; end if;
  if exists (select 1 from public.questions) then raise exception 'other teacher sees question bank'; end if;
end $$;

-- College HOD cannot approve an Elementary assessment.
select pg_temp.act_as((select v from ids where k = 'chod'));
select pg_temp.expect_error($q$
  select public.review_assessment((select v from ids where k = 'asmt'), true, null)
$q$, 'permission');

select pg_temp.act_as((select v from ids where k = 'hod'));
select public.review_assessment((select v from ids where k = 'asmt'), true, 'Looks good');
select public.schedule_window((select v from ids where k = 'asmt'), (select v from ids where k = 'c4a'),
                              now() - interval '5 minutes', now() + interval '2 hours', false);
insert into ids values ('win', (select id from public.exam_windows limit 1));

-- Editing frozen assessment is blocked.
select pg_temp.act_as((select v from ids where k = 'dixon'));
select pg_temp.expect_error($q$
  do $d$ begin
    update public.assessments set title = 'hacked' where id = (select v from ids where k = 'asmt');
    if not found then raise exception 'row-level security: no rows'; end if;
  end $d$
$q$, 'row-level security');

-- ---------------------------------------------------------------------------
-- Exam: nobody can start until the admin starts it.
-- ---------------------------------------------------------------------------
select pg_temp.act_as(null);
insert into public.lab_terminals (id, school_id, name, token_hash)
values (gen_random_uuid(), (select v from ids where k = 'sch'), 'Lab PC 1', 'h1'),
       (gen_random_uuid(), (select v from ids where k = 'sch'), 'Lab PC 2', 'h2');
insert into ids values ('pc1', (select id from public.lab_terminals where name = 'Lab PC 1')),
                       ('pc2', (select id from public.lab_terminals where name = 'Lab PC 2')),
                       ('charles', (select id from public.students where first_name = 'Charles')),
                       ('amaka', (select id from public.students where first_name = 'Amaka')),
                       ('tunde', (select id from public.students where first_name = 'Tunde'));

do $$ declare r jsonb; begin
  r := public.exam_start((select v from ids where k = 'charles'), (select v from ids where k = 'win'),
                         (select v from ids where k = 'pc1'), 'admission_no');
  if r ->> 'error' <> 'exam_awaiting_start' then raise exception 'expected awaiting_start, got %', r; end if;
  if (public.exam_available((select v from ids where k = 'charles')) -> 0 ->> 'state') <> 'awaiting_start' then
    raise exception 'exam_available state wrong';
  end if;
end $$;

-- Admin without exam.start cannot start; HOD can.
select pg_temp.act_as((select v from ids where k = 'chod'));
select pg_temp.expect_error($q$ select public.window_action((select v from ids where k = 'win'), 'start') $q$, 'permission');
select pg_temp.act_as((select v from ids where k = 'hod'));
select public.window_action((select v from ids where k = 'win'), 'start');

select pg_temp.act_as(null);
do $$
declare
  r jsonb; att uuid; qs jsonb; ans jsonb := '[]'::jsonb; q jsonb; key text; i int := 0;
begin
  -- Student from another class cannot start.
  r := public.exam_start((select v from ids where k = 'tunde'), (select v from ids where k = 'win'),
                         (select v from ids where k = 'pc2'), 'admission_no');
  if r ->> 'error' <> 'not_your_class' then raise exception 'expected not_your_class, got %', r; end if;

  r := public.exam_start((select v from ids where k = 'charles'), (select v from ids where k = 'win'),
                         (select v from ids where k = 'pc1'), 'admission_no');
  if r ? 'error' then raise exception 'start failed: %', r; end if;
  att := (r -> 'attempt' ->> 'id')::uuid;
  insert into ids values ('att', att);
  qs := r -> 'questions';
  if jsonb_array_length(qs) <> 5 then raise exception 'expected 5 questions drawn from pool of 6'; end if;
  if r::text like '%"answer"%' then raise exception 'answer key leaked to terminal payload'; end if;

  -- Same student on another PC is blocked and flagged.
  r := public.exam_start((select v from ids where k = 'charles'), (select v from ids where k = 'win'),
                         (select v from ids where k = 'pc2'), 'name_search');
  if r ->> 'error' <> 'locked_other_terminal' then raise exception 'expected lock, got %', r; end if;

  -- Same PC resumes.
  r := public.exam_start((select v from ids where k = 'charles'), (select v from ids where k = 'win'),
                         (select v from ids where k = 'pc1'), 'admission_no');
  if (r -> 'attempt' ->> 'id')::uuid <> att then raise exception 'resume returned a different attempt'; end if;

  -- Answer 4 of 5 correctly ("B" is the original key; option order is shuffled but keys are stable).
  for q in select * from jsonb_array_elements(qs) loop
    i := i + 1;
    key := case when i <= 4 then 'B' else 'A' end;
    ans := ans || jsonb_build_array(jsonb_build_object('q', q ->> 'id', 's', key, 'f', false, 'at', now()));
  end loop;

  -- An answer stamped after the deadline is rejected.
  r := public.exam_sync(att, jsonb_build_array(jsonb_build_object(
          'q', qs -> 0 ->> 'id', 's', 'C', 'f', false, 'at', now() + interval '3 hours')), '[{"type":"focus_lost"}]');
  if (r ->> 'rejected')::int <> 1 then raise exception 'late answer accepted: %', r; end if;

  -- Sync first 3 only, then try to submit: require_all_answered blocks it.
  r := public.exam_sync(att, (select jsonb_agg(e) from (select e from jsonb_array_elements(ans) e limit 3) z), '[]');
  if (r ->> 'accepted')::int <> 3 then raise exception 'sync failed: %', r; end if;
  r := public.exam_submit(att, '[]', '[]', 'student');
  if r ->> 'error' <> 'unanswered' or (r ->> 'missing')::int <> 2 then raise exception 'expected unanswered: %', r; end if;

  r := public.exam_submit(att, ans, '[]', 'student');
  if r ->> 'status' <> 'submitted' then raise exception 'submit failed: %', r; end if;
  if (r ->> 'score')::numeric <> 4 or (r ->> 'max_score')::numeric <> 5 then raise exception 'wrong score: %', r; end if;

  -- After submission: answers are locked, the attempt can't be restarted, syncs are ignored.
  r := public.exam_start((select v from ids where k = 'charles'), (select v from ids where k = 'win'),
                         (select v from ids where k = 'pc1'), 'admission_no');
  if r ->> 'error' <> 'already_submitted' then raise exception 'expected already_submitted: %', r; end if;
  r := public.exam_sync(att, ans, '[]');
  if r ->> 'status' <> 'submitted' then raise exception 'sync after submit should report submitted'; end if;
  if (select focus_losses from public.attempts where id = att) <> 1 then raise exception 'focus loss not counted'; end if;
end $$;

select pg_temp.expect_error($q$
  update public.attempt_answers set selected = 'D' where attempt_id = (select v from ids where k = 'att')
$q$, 'answers are locked');
select pg_temp.expect_error($q$
  update public.attempts set status = 'in_progress' where id = (select v from ids where k = 'att')
$q$, 'cannot be reopened');

-- ---------------------------------------------------------------------------
-- Results visibility, key correction and regrade
-- ---------------------------------------------------------------------------
select pg_temp.act_as((select v from ids where k = 'other'));
do $$ begin
  if exists (select 1 from public.attempts) then raise exception 'other teacher sees results'; end if;
end $$;
select pg_temp.act_as((select v from ids where k = 'dixon'));
do $$
declare
  last_q uuid;
begin
  if (select count(*) from public.attempts) <> 1 then raise exception 'Dixon should see the attempt'; end if;
  -- Question Charles answered "A": make "A" the right key → he now gets 5/5.
  select question_id into last_q from public.attempt_answers
   where attempt_id = (select v from ids where k = 'att') and selected = 'A';
  perform public.correct_answer_key((select v from ids where k = 'asmt'), last_q, 'A');
  if (select score from public.attempts where id = (select v from ids where k = 'att')) <> 5 then
    raise exception 'regrade failed';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Make-ups need the permission the super admin grants.
-- ---------------------------------------------------------------------------
select pg_temp.act_as((select v from ids where k = 'hod'));
select pg_temp.expect_error($q$
  select public.grant_makeup((select v from ids where k = 'win'), (select v from ids where k = 'amaka'),
                             now(), now() + interval '1 hour', 'Was sick')
$q$, 'permission');

select pg_temp.act_as((select v from ids where k = 'sup'));
insert into public.staff_permissions (staff_id, permission, granted_by)
values ((select v from ids where k = 'hod'), 'exam.grant_makeup', (select v from ids where k = 'sup'));

select pg_temp.act_as((select v from ids where k = 'hod'));
select public.window_action((select v from ids where k = 'win'), 'close');
select public.grant_makeup((select v from ids where k = 'win'), (select v from ids where k = 'amaka'),
                           now() - interval '1 minute', now() + interval '1 hour', 'Was sick');

select pg_temp.act_as(null);
do $$ declare r jsonb; begin
  r := public.exam_start((select v from ids where k = 'amaka'), (select v from ids where k = 'win'),
                         (select v from ids where k = 'pc2'), 'name_search');
  if r ? 'error' or not (r -> 'attempt' ->> 'is_makeup')::boolean then raise exception 'make-up start failed: %', r; end if;
end $$;

-- ---------------------------------------------------------------------------
-- Unlock re-login moves an in-progress attempt to a new PC (once).
-- ---------------------------------------------------------------------------
select pg_temp.act_as((select v from ids where k = 'hod'));
select public.unlock_relogin((select v from ids where k = 'win'), (select v from ids where k = 'amaka'), 'PC 2 froze');
select pg_temp.act_as(null);
do $$ declare r jsonb; begin
  r := public.exam_start((select v from ids where k = 'amaka'), (select v from ids where k = 'win'),
                         (select v from ids where k = 'pc1'), 'admission_no');
  if r ? 'error' then raise exception 'unlocked relogin failed: %', r; end if;
  r := public.exam_start((select v from ids where k = 'amaka'), (select v from ids where k = 'win'),
                         (select v from ids where k = 'pc2'), 'admission_no');
  if r ->> 'error' <> 'locked_other_terminal' then raise exception 'unlock should be single-use: %', r; end if;
end $$;

-- Abandoned attempts are finalised after the upload grace period.
reset role;
update public.attempts set deadline = now() - interval '2 hours' where student_id = (select v from ids where k = 'amaka');
do $$ begin
  if public.finalize_expired_attempts() <> 1 then raise exception 'finalize did not pick up abandoned attempt'; end if;
  if (select submit_source from public.attempts where student_id = (select v from ids where k = 'amaka')) <> 'auto_finalize' then
    raise exception 'wrong submit source';
  end if;
end $$;

-- Anonymous users get nothing.
select pg_temp.act_as(null);
reset role;
set local role anon;
select pg_temp.expect_error($q$ select * from public.students $q$, 'permission denied');
select pg_temp.expect_error($q$ select public.exam_start(gen_random_uuid(), gen_random_uuid(), null, 'x') $q$, 'permission denied');
reset role;

-- Audit trail recorded the privileged actions and cannot be edited.
do $$ begin
  if (select count(*) from public.audit_log) < 8 then raise exception 'audit log too small'; end if;
end $$;
select pg_temp.expect_error($q$ delete from public.audit_log $q$, 'append-only');

\echo '01_exam_flow: ok'
rollback;
