-- Exam calendar and question comments: who may read and write them. Rolled back.
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
  col uuid := (select id from public.sections where code <> 'ELEM' order by sort limit 1);
  y4 uuid := (select id from public.years where section_id = elem and level = 4);
  bio uuid := (select id from public.subjects where section_id = elem and name = 'Basic Science');
  term uuid := (select id from public.terms where is_current);
  hod uuid := gen_random_uuid(); other uuid := gen_random_uuid(); teacher uuid := gen_random_uuid();
  aid uuid; q uuid; rnd uuid := (select id from public.ca_round_configs order by sort_order limit 1);
begin
  insert into auth.users (id, email) values (hod, 'h6@lps.test'), (other, 'o6@lps.test'), (teacher, 't6@lps.test');
  insert into public.staff (id, school_id, email, full_name, role) values
    (hod, sch, 'h6@lps.test', 'HOD', 'admin'), (other, sch, 'o6@lps.test', 'College HOD', 'admin'),
    (teacher, sch, 't6@lps.test', 'Teacher', 'teacher');
  insert into public.admin_sections values (hod, elem), (other, col);
  insert into public.staff_permissions (staff_id, permission) values (hod, 'exam.approve'), (other, 'exam.approve');
  insert into public.questions (subject_id, year_id, body, options, answer, owner_id)
  values (bio, y4, 'Comment Q', '[{"key":"A","text":"a"},{"key":"B","text":"b"}]', 'A', teacher) returning id into q;
  insert into public.assessments (subject_id, year_id, term_id, title, type, question_count, duration_minutes, created_by, status)
  values (bio, y4, term, 'Comment test', 'test', 1, 20, teacher, 'pending_approval') returning id into aid;
  insert into public.assessment_questions (assessment_id, question_id, position) values (aid, q, 1);
  insert into ids values ('hod', hod), ('other', other), ('teacher', teacher), ('aid', aid), ('q', q), ('y4', y4), ('term', term), ('rnd', rnd);
end $$;

-- The section's Head of Section sets the calendar; a teacher and another section's head cannot.
select pg_temp.act_as((select v from ids where k = 'hod'));
insert into public.round_schedules (round_id, term_id, year_id, starts_at, ends_at)
values ((select v from ids where k = 'rnd'), (select v from ids where k = 'term'), (select v from ids where k = 'y4'), now() + interval '1 day', now() + interval '1 day 2 hours');
select pg_temp.act_as((select v from ids where k = 'teacher'));
do $$ begin
  if not exists (select 1 from public.round_schedules) then raise exception 'teacher cannot read the calendar'; end if;
end $$;
select pg_temp.expect_error($q$
  insert into public.round_schedules (round_id, term_id, year_id, starts_at, ends_at)
  values ((select v from ids where k = 'rnd'), (select v from ids where k = 'term'), (select v from ids where k = 'y4'), now(), now() + interval '1 hour')
$q$, 'row-level security');
select pg_temp.act_as((select v from ids where k = 'other'));
do $$
declare n int;
begin
  update public.round_schedules set ends_at = ends_at + interval '1 hour';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'another section''s head changed the calendar'; end if;
end $$;

-- Comments: the Head of Section writes them; the teacher sees them and marks them fixed, but cannot write one.
select pg_temp.act_as((select v from ids where k = 'hod'));
insert into public.review_comments (assessment_id, question_id, body, author_id)
values ((select v from ids where k = 'aid'), (select v from ids where k = 'q'), 'The answer should be B', (select v from ids where k = 'hod'));
select pg_temp.act_as((select v from ids where k = 'other'));
select pg_temp.expect_error($q$
  insert into public.review_comments (assessment_id, question_id, body, author_id)
  values ((select v from ids where k = 'aid'), (select v from ids where k = 'q'), 'Not my section', (select v from ids where k = 'other'))
$q$, 'row-level security');
select pg_temp.act_as((select v from ids where k = 'teacher'));
select pg_temp.expect_error($q$
  insert into public.review_comments (assessment_id, body, author_id)
  values ((select v from ids where k = 'aid'), 'Self-approval', (select v from ids where k = 'teacher'))
$q$, 'row-level security');
do $$
declare n int;
begin
  if (select count(*) from public.review_comments) <> 1 then raise exception 'teacher cannot see the comment'; end if;
  update public.review_comments set resolved_at = now();
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'teacher could not mark the comment fixed'; end if;
  delete from public.review_comments;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'teacher deleted the reviewer''s comment'; end if;
end $$;

select pg_temp.expect_error($q$ update public.review_comments set body = 'Reworded' $q$, 'permission denied');

-- An empty comment is refused.
select pg_temp.act_as((select v from ids where k = 'hod'));
select pg_temp.expect_error($q$
  insert into public.review_comments (assessment_id, body, author_id) values ((select v from ids where k = 'aid'), '   ', (select v from ids where k = 'hod'))
$q$, 'check');
rollback;
