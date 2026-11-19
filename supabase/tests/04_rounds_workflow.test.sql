-- Rounds on uploads, one-step "let a student continue", the old resume path, and who reads the error log.
-- Runs in a transaction that is rolled back.
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

create temp table ids (k text primary key, v uuid);
grant all on ids to authenticated, service_role;

do $$
declare
  sch uuid := (select id from public.schools limit 1);
  elem uuid := (select id from public.sections where code = 'ELEM');
  y4 uuid := (select id from public.years where section_id = elem and level = 4);
  bio uuid := (select id from public.subjects where section_id = elem and name = 'Basic Science');
  term uuid := (select id from public.terms where is_current);
  hod uuid := gen_random_uuid(); helper uuid := gen_random_uuid(); teacher uuid := gen_random_uuid();
  cls uuid; stu uuid; aid uuid; wid uuid; att uuid; att2 uuid; stu2 uuid; rnd uuid;
begin
  insert into auth.users (id, email) values (hod, 'h4@lps.test'), (helper, 'x4@lps.test'), (teacher, 't4@lps.test');
  insert into public.staff (id, school_id, email, full_name, role) values
    (hod, sch, 'h4@lps.test', 'HOD', 'admin'), (helper, sch, 'x4@lps.test', 'No extra-time HOD', 'admin'),
    (teacher, sch, 't4@lps.test', 'Teacher', 'teacher');
  insert into public.admin_sections values (hod, elem), (helper, elem);
  insert into public.staff_permissions (staff_id, permission) values (hod, 'exam.extend_time'), (hod, 'exam.start'), (helper, 'exam.start');
  insert into public.classes (year_id, name) values (y4, 'Year 4 Rounds') returning id into cls;
  insert into public.teaching_assignments (teacher_id, subject_id, class_id, session_id, status)
  values (teacher, bio, cls, (select id from public.academic_sessions where is_current), 'approved');
  insert into public.students (school_id, admission_no, first_name, last_name, class_id) values (sch, 'R4/1', 'Ada', 'One', cls) returning id into stu;
  insert into public.students (school_id, admission_no, first_name, last_name, class_id) values (sch, 'R4/2', 'Bola', 'Two', cls) returning id into stu2;
  insert into public.assessments (subject_id, year_id, term_id, title, type, question_count, duration_minutes, created_by, status, paper)
  values (bio, y4, term, 'Rounds test', 'test', 1, 20, teacher, 'approved', '{"questions":[]}') returning id into aid;
  insert into public.exam_windows (assessment_id, class_id, starts_at, ends_at, status)
  values (aid, cls, now() - interval '2 hours', now() - interval '1 hour', 'closed') returning id into wid;
  insert into public.attempts (window_id, assessment_id, student_id, class_id, status, question_order, deadline, submitted_at, total_questions)
  values (wid, aid, stu, cls, 'submitted', '[]', now() - interval '90 minutes', now() - interval '90 minutes', 1) returning id into att;
  insert into public.attempts (window_id, assessment_id, student_id, class_id, status, question_order, deadline, submitted_at, total_questions)
  values (wid, aid, stu2, cls, 'submitted', '[]', now() - interval '90 minutes', now() - interval '90 minutes', 1) returning id into att2;
  select id into rnd from public.ca_round_configs where label = '2nd CA';
  insert into ids values ('hod', hod), ('helper', helper), ('teacher', teacher), ('stu', stu), ('stu2', stu2),
    ('aid', aid), ('wid', wid), ('att', att), ('att2', att2), ('bio', bio), ('y4', y4), ('term', term), ('rnd', rnd);
end $$;

-- A finished attempt still can't be reopened directly.
select pg_temp.expect_error($q$ update public.attempts set status = 'in_progress' where id = (select v from ids where k = 'att') $q$, 'cannot be reopened');

-- Only someone with the extra-time permission can let a student continue.
select pg_temp.act_as((select v from ids where k = 'helper'));
select pg_temp.expect_error($q$
  select public.let_student_continue((select v from ids where k = 'wid'), (select v from ids where k = 'stu'), 10, 'power cut')
$q$, 'permission');
select pg_temp.act_as((select v from ids where k = 'hod'));
select pg_temp.expect_error($q$
  select public.let_student_continue((select v from ids where k = 'wid'), (select v from ids where k = 'stu'), 10, '  ')
$q$, 'say why');

-- One step: reopened, extra time on record, any computer, window open again, history kept.
do $$
declare dl timestamptz;
begin
  dl := public.let_student_continue((select v from ids where k = 'wid'), (select v from ids where k = 'stu'), 15, 'Power cut 10:20');
  if (select status from public.attempts where id = (select v from ids where k = 'att')) <> 'in_progress' then raise exception 'not reopened'; end if;
  if (select deadline from public.attempts where id = (select v from ids where k = 'att')) <> dl then raise exception 'deadline not set'; end if;
  if not exists (select 1 from public.exam_exceptions where student_id = (select v from ids where k = 'stu') and kind = 'relogin_unlock') then raise exception 'no unlock'; end if;
  if not exists (select 1 from public.exam_exceptions where student_id = (select v from ids where k = 'stu') and kind = 'extra_time' and extra_minutes = 15) then raise exception 'extra time not recorded'; end if;
  if (select status from public.exam_windows where id = (select v from ids where k = 'wid')) <> 'live' then raise exception 'window not reopened'; end if;
  if not exists (select 1 from public.resume_requests where student_id = (select v from ids where k = 'stu') and status = 'approved') then raise exception 'not in resume history'; end if;
  if current_setting('cbt.reopen_attempt', true) <> '' then raise exception 'reopen permission left switched on'; end if;
end $$;

-- The older two-step path now works too (it used to be refused by the attempts guard).
reset role;
update public.exam_windows set extra_minutes = 5 where id = (select v from ids where k = 'wid');
select pg_temp.act_as((select v from ids where k = 'hod'));
do $$
declare rid uuid;
begin
  rid := public.request_resume((select v from ids where k = 'wid'), (select v from ids where k = 'stu2'));
  perform public.approve_resume(rid);
  if (select status from public.attempts where id = (select v from ids where k = 'att2')) <> 'in_progress' then raise exception 'two-step resume did not reopen'; end if;
end $$;

-- Uploads record their round and term on every question.
select pg_temp.act_as((select v from ids where k = 'teacher'));
do $$
declare r jsonb;
begin
  r := public.import_questions(
    jsonb_build_object('subject_id', (select v from ids where k = 'bio'), 'year_id', (select v from ids where k = 'y4'),
      'round_id', (select v from ids where k = 'rnd'), 'term_id', (select v from ids where k = 'term'), 'label', '2nd CA set'),
    '[{"body":"Round Q","options":[{"key":"A","text":"a"},{"key":"B","text":"b"}],"answer":"A"}]'::jsonb);
  if (select round_id from public.questions where body = 'Round Q') is distinct from (select v from ids where k = 'rnd') then raise exception 'round not on question'; end if;
  if (select term_id from public.questions where body = 'Round Q') is distinct from (select v from ids where k = 'term') then raise exception 'term not on question'; end if;
  if (select round_id from public.question_uploads where id = (r->>'upload_id')::uuid) is distinct from (select v from ids where k = 'rnd') then raise exception 'round not on upload'; end if;
end $$;

-- Teachers see every round they may pick (active only); admins see hidden ones too.
reset role;
update public.ca_round_configs set is_active = false where label = 'Mid-Term';
select pg_temp.act_as((select v from ids where k = 'teacher'));
do $$ begin
  if exists (select 1 from public.ca_round_configs where label = 'Mid-Term') then raise exception 'teacher sees hidden round'; end if;
end $$;
select pg_temp.act_as((select v from ids where k = 'hod'));
do $$ begin
  if not exists (select 1 from public.ca_round_configs where label = 'Mid-Term') then raise exception 'admin cannot see hidden round'; end if;
end $$;

-- Error log: written only by the server; a teacher reads only their own; nobody can write from the browser.
reset role;
insert into public.app_errors (ref, staff_id, area, message) values
  ('TEACH1', (select v from ids where k = 'teacher'), 'questions.import', 'boom'),
  ('OTHER2', (select v from ids where k = 'helper'), 'action', 'boom');
select pg_temp.act_as((select v from ids where k = 'teacher'));
do $$ begin
  if (select count(*) from public.app_errors where ref in ('TEACH1', 'OTHER2')) <> 1 then raise exception 'teacher sees others errors'; end if;
end $$;
select pg_temp.expect_error($q$ insert into public.app_errors (ref, area, message) values ('HACKED', 'x', 'y') $q$, 'app_errors');

rollback;
