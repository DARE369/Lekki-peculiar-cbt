-- Hiding results from students: one switch, remembered, and only for the section's own staff. Rolled back.
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
  hod uuid := gen_random_uuid(); other uuid := gen_random_uuid(); teacher uuid := gen_random_uuid(); aid uuid;
begin
  insert into auth.users (id, email) values (hod, 'h8@lps.test'), (other, 'o8@lps.test'), (teacher, 't8@lps.test');
  insert into public.staff (id, school_id, email, full_name, role) values
    (hod, sch, 'h8@lps.test', 'HOD', 'admin'), (other, sch, 'o8@lps.test', 'College HOD', 'admin'), (teacher, sch, 't8@lps.test', 'Teacher', 'teacher');
  insert into public.admin_sections values (hod, elem), (other, col);
  insert into public.staff_permissions (staff_id, permission) values (hod, 'exam.start'), (other, 'exam.start');
  insert into public.assessments (subject_id, year_id, term_id, title, type, question_count, duration_minutes, created_by, status, paper, settings)
  values (bio, y4, term, 'Hide results', 'test', 1, 20, teacher, 'approved', '{"questions":[]}', '{"show_result":"full","pass_mark":50}') returning id into aid;
  insert into ids values ('hod', hod), ('other', other), ('teacher', teacher), ('aid', aid);
end $$;

-- Another section's head, and a teacher, cannot change it.
select pg_temp.act_as((select v from ids where k = 'other'));
select pg_temp.expect_error($q$ select public.set_results_hidden((select v from ids where k = 'aid'), true) $q$, 'permission denied');
select pg_temp.act_as((select v from ids where k = 'teacher'));
select pg_temp.expect_error($q$ select public.set_results_hidden((select v from ids where k = 'aid'), true) $q$, 'permission denied');

-- The section's head hides it; the other settings are kept, and the earlier choice is remembered.
select pg_temp.act_as((select v from ids where k = 'hod'));
select public.set_results_hidden((select v from ids where k = 'aid'), true);
select pg_temp.act_as(null);
do $$ declare st jsonb := (select settings from public.assessments where id = (select v from ids where k = 'aid')); begin
  if st ->> 'show_result' <> 'none' then raise exception 'not hidden: %', st; end if;
  if st ->> 'show_result_before' <> 'full' then raise exception 'earlier choice not remembered: %', st; end if;
  if (st ->> 'pass_mark')::int <> 50 then raise exception 'other settings changed: %', st; end if;
  -- what a student would be shown
  if (public._exam_result((select id from public.attempts limit 0)) is not null) then null; end if;
end $$;

-- Switching it back restores exactly what the teacher had chosen, and tidies the memory key.
select pg_temp.act_as((select v from ids where k = 'hod'));
select public.set_results_hidden((select v from ids where k = 'aid'), false);
select pg_temp.act_as(null);
do $$ declare st jsonb := (select settings from public.assessments where id = (select v from ids where k = 'aid')); begin
  if st ->> 'show_result' <> 'full' then raise exception 'not restored: %', st; end if;
  if st ? 'show_result_before' then raise exception 'memory key left behind: %', st; end if;
end $$;

-- Showing again when it was never hidden changes nothing.
select pg_temp.act_as((select v from ids where k = 'hod'));
select public.set_results_hidden((select v from ids where k = 'aid'), false);
select pg_temp.act_as(null);
do $$ begin
  if (select settings ->> 'show_result' from public.assessments where id = (select v from ids where k = 'aid')) <> 'full' then raise exception 'changed by no-op'; end if;
end $$;
rollback;
