-- The focus-leave penalty can be set (one or many exams) by the people allowed to, and nobody else. Rolled back.
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
  col uuid := (select id from public.sections where code <> 'ELEM' order by sort limit 1);
  y4 uuid := (select id from public.years where section_id = elem and level = 4);
  bio uuid := (select id from public.subjects where section_id = elem and name = 'Basic Science');
  term uuid := (select id from public.terms where is_current);
  hod uuid := gen_random_uuid(); noperm uuid := gen_random_uuid(); other uuid := gen_random_uuid(); teacher uuid := gen_random_uuid();
  c1 uuid; c2 uuid; aid uuid; w1 uuid; w2 uuid;
begin
  insert into auth.users (id, email) values (hod, 'h10@lps.test'), (noperm, 'n10@lps.test'), (other, 'o10@lps.test'), (teacher, 't10@lps.test');
  insert into public.staff (id, school_id, email, full_name, role) values
    (hod, sch, 'h10@lps.test', 'HOD', 'admin'), (noperm, sch, 'n10@lps.test', 'No perm', 'admin'),
    (other, sch, 'o10@lps.test', 'College', 'admin'), (teacher, sch, 't10@lps.test', 'Teacher', 'teacher');
  insert into public.admin_sections values (hod, elem), (noperm, elem), (other, col);
  insert into public.staff_permissions (staff_id, permission) values (hod, 'exam.start'), (other, 'exam.start');
  insert into public.classes (year_id, name) values (y4, 'Year 4 Pen A') returning id into c1;
  insert into public.classes (year_id, name) values (y4, 'Year 4 Pen B') returning id into c2;
  insert into public.assessments (subject_id, year_id, term_id, title, type, question_count, duration_minutes, created_by, status, paper)
  values (bio, y4, term, 'Penalty test', 'test', 1, 20, teacher, 'approved', '{"questions":[]}') returning id into aid;
  insert into public.exam_windows (assessment_id, class_id, starts_at, ends_at, status) values (aid, c1, now(), now() + interval '1 hour', 'live') returning id into w1;
  insert into public.exam_windows (assessment_id, class_id, starts_at, ends_at, status) values (aid, c2, now(), now() + interval '1 hour', 'live') returning id into w2;
  insert into ids values ('hod', hod), ('noperm', noperm), ('other', other), ('teacher', teacher), ('w1', w1), ('w2', w2);
end $$;

-- A Head of Section with the permission sets it on both exams in one go.
select pg_temp.act_as((select v from ids where k = 'hod'));
do $$ begin
  if public.set_focus_penalty(array[(select v from ids where k = 'w1'), (select v from ids where k = 'w2')], 5) <> 2 then raise exception 'did not change both'; end if;
end $$;
select pg_temp.act_as(null);
do $$ begin
  if (select count(*) from public.exam_windows where focus_penalty_minutes = 5 and id in ((select v from ids where k='w1'), (select v from ids where k='w2'))) <> 2 then raise exception 'penalty not saved'; end if;
  if not exists (select 1 from public.audit_log where action = 'window.focus_penalty') then raise exception 'not recorded in the audit log'; end if;
end $$;

-- Without the permission, from another section, and teachers: refused, nothing changes.
select pg_temp.act_as((select v from ids where k = 'noperm'));
select pg_temp.expect_error($q$ select public.set_focus_penalty(array[(select v from ids where k = 'w1')], 0) $q$, 'permission');
select pg_temp.act_as((select v from ids where k = 'other'));
select pg_temp.expect_error($q$ select public.set_focus_penalty(array[(select v from ids where k = 'w1')], 0) $q$, 'permission');
select pg_temp.act_as((select v from ids where k = 'teacher'));
select pg_temp.expect_error($q$ select public.set_focus_penalty(array[(select v from ids where k = 'w1')], 0) $q$, 'permission');
select pg_temp.act_as((select v from ids where k = 'hod'));
select pg_temp.expect_error($q$ select public.set_focus_penalty(array[(select v from ids where k = 'w1')], 61) $q$, 'between 0 and 60');
select pg_temp.expect_error($q$ select public.set_focus_penalty(array[]::uuid[], 5) $q$, 'between 1 and 100');
select pg_temp.act_as(null);
do $$ begin
  if (select focus_penalty_minutes from public.exam_windows where id = (select v from ids where k='w1')) <> 5 then raise exception 'a refused request changed the exam'; end if;
end $$;
rollback;
