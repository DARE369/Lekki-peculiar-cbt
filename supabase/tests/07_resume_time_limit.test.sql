-- A finished exam can only be continued for a day after it closed; after that the results stand. Rolled back.
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
  hod uuid := gen_random_uuid(); teacher uuid := gen_random_uuid();
  cls uuid; stu uuid; stu2 uuid; aid uuid; old_w uuid; new_w uuid; att uuid; att2 uuid; req uuid;
begin
  insert into auth.users (id, email) values (hod, 'h7@lps.test'), (teacher, 't7@lps.test');
  insert into public.staff (id, school_id, email, full_name, role) values
    (hod, sch, 'h7@lps.test', 'HOD', 'admin'), (teacher, sch, 't7@lps.test', 'Teacher', 'teacher');
  insert into public.admin_sections values (hod, elem);
  insert into public.staff_permissions (staff_id, permission) values (hod, 'exam.extend_time'), (hod, 'exam.start');
  insert into public.classes (year_id, name) values (y4, 'Year 4 Expiry') returning id into cls;
  insert into public.students (school_id, admission_no, first_name, last_name, class_id) values (sch, 'E7/1', 'Old', 'One', cls) returning id into stu;
  insert into public.students (school_id, admission_no, first_name, last_name, class_id) values (sch, 'E7/2', 'Old', 'Two', cls) returning id into stu2;
  insert into public.assessments (subject_id, year_id, term_id, title, type, question_count, duration_minutes, created_by, status, paper)
  values (bio, y4, term, 'Expiry test', 'test', 1, 20, teacher, 'approved', '{"questions":[]}') returning id into aid;
  -- An exam that closed two days ago, with a request left pending since then.
  insert into public.exam_windows (assessment_id, class_id, starts_at, ends_at, status, extra_minutes)
  values (aid, cls, now() - interval '50 hours', now() - interval '48 hours', 'closed', 10) returning id into old_w;
  insert into public.attempts (window_id, assessment_id, student_id, class_id, status, question_order, deadline, submitted_at, total_questions, score)
  values (old_w, aid, stu, cls, 'submitted', '[]', now() - interval '49 hours', now() - interval '49 hours', 1, 1) returning id into att;
  insert into public.attempts (window_id, assessment_id, student_id, class_id, status, question_order, deadline, submitted_at, total_questions, score)
  values (old_w, aid, stu2, cls, 'submitted', '[]', now() - interval '49 hours', now() - interval '49 hours', 1, 1) returning id into att2;
  insert into public.resume_requests (window_id, attempt_id, student_id, extra_minutes, requested_by, requested_at)
  values (old_w, att, stu, 60, hod, now() - interval '48 hours') returning id into req;
  insert into ids values ('hod', hod), ('old_w', old_w), ('stu', stu), ('stu2', stu2), ('att', att), ('req', req);
end $$;

select pg_temp.act_as((select v from ids where k = 'hod'));

-- The old request can't be approved, and nobody can be let back in.
select pg_temp.expect_error($q$ select public.approve_resume((select v from ids where k = 'req')) $q$, 'closed more than a day ago');
select pg_temp.expect_error($q$
  select public.let_student_continue((select v from ids where k = 'old_w'), (select v from ids where k = 'stu2'), 10, 'late')
$q$, 'closed more than a day ago');
select pg_temp.expect_error($q$
  select public.request_resume((select v from ids where k = 'old_w'), (select v from ids where k = 'stu2'))
$q$, 'closed more than a day ago');

-- Nothing changed: the score stands and the exam stays closed.
select pg_temp.act_as(null);
do $$ begin
  if (select status from public.attempts where id = (select v from ids where k = 'att')) <> 'submitted' then raise exception 'old attempt was reopened'; end if;
  if (select score from public.attempts where id = (select v from ids where k = 'att')) is distinct from 1 then raise exception 'old score was cleared'; end if;
  if (select status from public.exam_windows where id = (select v from ids where k = 'old_w')) <> 'closed' then raise exception 'old exam was reopened'; end if;
end $$;
rollback;
