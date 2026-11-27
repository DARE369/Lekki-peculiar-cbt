-- The one-off "move Second Term to First Term" script (supabase/one-off): only the term changes, nothing else does.
-- Runs the real scripts against realistic data. Rolled back.
begin;
create or replace function pg_temp.expect_error(sql text, fragment text) returns void language plpgsql as $$
begin
  execute sql;
  raise exception 'expected error containing "%" but statement succeeded: %', fragment, sql;
exception when others then
  if position(fragment in sqlerrm) = 0 then raise exception 'expected error containing "%" but got "%"', fragment, sqlerrm; end if;
end $$;
create temp table ids (k text primary key, v uuid);

do $$
declare
  sch uuid := (select id from public.schools limit 1);
  elem uuid := (select id from public.sections where code = 'ELEM');
  y4 uuid := (select id from public.years where section_id = elem and level = 4);
  y5 uuid := (select id from public.years where section_id = elem and level = 5);
  bio uuid := (select id from public.subjects where section_id = elem and name = 'Basic Science');
  cur uuid := (select id from public.academic_sessions where is_current);
  t1 uuid := (select id from public.terms where session_id = (select id from public.academic_sessions where is_current) and ordinal = 1);
  t2 uuid := (select id from public.terms where session_id = (select id from public.academic_sessions where is_current) and ordinal = 2);
  rnd uuid := (select id from public.ca_round_configs order by sort_order limit 1);
  teacher uuid := gen_random_uuid();
  old_s uuid; old_t1 uuid; old_t2 uuid;
  cls uuid; stu uuid; a1 uuid; a2 uuid; a3 uuid; a4 uuid; win uuid; att uuid; q1 uuid; q2 uuid;
begin
  insert into auth.users (id, email) values (teacher, 't11@lps.test');
  insert into public.staff (id, school_id, email, full_name, role) values (teacher, sch, 't11@lps.test', 'Teacher', 'teacher');
  -- An earlier year, whose Second Term must never be touched.
  insert into public.academic_sessions (school_id, name) values (sch, '2025/2026 (test)') returning id into old_s;
  insert into public.terms (session_id, name, ordinal) values (old_s, 'First Term', 1) returning id into old_t1;
  insert into public.terms (session_id, name, ordinal) values (old_s, 'Second Term', 2) returning id into old_t2;

  insert into public.classes (year_id, name) values (y4, 'Year 4 Move') returning id into cls;
  insert into public.students (school_id, admission_no, first_name, last_name, class_id) values (sch, 'MV/1', 'Ola', 'Move', cls) returning id into stu;

  -- Tests, with edit times set to known past moments.
  insert into public.assessments (subject_id, year_id, term_id, title, type, question_count, duration_minutes, created_by, status, updated_at)
    values (bio, y4, t2, 'Draft in second term', 'test', 1, 20, teacher, 'draft', '2026-01-05 10:00+00') returning id into a1;
  insert into public.assessments (subject_id, year_id, term_id, title, type, question_count, duration_minutes, created_by, status, paper, updated_at)
    values (bio, y4, t2, 'Approved, with results', 'test', 1, 20, teacher, 'approved', '{"questions":[]}', '2026-02-06 11:00+00') returning id into a2;
  insert into public.assessments (subject_id, year_id, term_id, title, type, question_count, duration_minutes, created_by, status, updated_at)
    values (bio, y4, t1, 'Already in first term', 'test', 1, 20, teacher, 'draft', '2026-03-07 12:00+00') returning id into a3;
  insert into public.assessments (subject_id, year_id, term_id, title, type, question_count, duration_minutes, created_by, status, updated_at)
    values (bio, y4, old_t2, 'Last year second term', 'test', 1, 20, teacher, 'draft', '2025-02-01 09:00+00') returning id into a4;
  insert into public.exam_windows (assessment_id, class_id, starts_at, ends_at, status) values (a2, cls, now() - interval '2 hours', now() - interval '1 hour', 'closed') returning id into win;
  insert into public.attempts (window_id, assessment_id, student_id, class_id, status, question_order, deadline, total_questions)
    values (win, a2, stu, cls, 'in_progress', '[]', now() + interval '30 minutes', 1) returning id into att;

  insert into public.questions (subject_id, year_id, owner_id, body, options, answer, term_id, updated_at)
    values (bio, y4, teacher, 'Second term question', '[{"key":"A","text":"x"},{"key":"B","text":"y"}]', 'A', t2, '2026-04-08 13:00+00') returning id into q1;
  insert into public.questions (subject_id, year_id, owner_id, body, options, answer, term_id)
    values (bio, y4, teacher, 'First term question', '[{"key":"A","text":"x"},{"key":"B","text":"y"}]', 'A', t1) returning id into q2;
  insert into public.attempt_answers (attempt_id, question_id, selected, answered_at) values (att, q1, 'A', now());
  update public.attempts set status = 'submitted', submitted_at = now(), score = 1, max_score = 1 where id = att;
  insert into public.question_uploads (owner_id, subject_id, year_id, term_id, label, source_format, found_count, imported_count)
    values (teacher, bio, y4, t2, 'Second term bank', 'manual', 1, 1);

  -- Exam calendar: year 4 already has a First Term date (a clash); year 5 does not.
  insert into public.round_schedules (round_id, term_id, year_id, starts_at, ends_at) values (rnd, t1, y4, now(), now() + interval '2 hours');
  insert into public.round_schedules (round_id, term_id, year_id, starts_at, ends_at) values (rnd, t2, y4, now() + interval '1 day', now() + interval '1 day 2 hours');
  insert into public.round_schedules (round_id, term_id, year_id, starts_at, ends_at) values (rnd, t2, y5, now() + interval '1 day', now() + interval '1 day 2 hours');

  insert into ids values ('t1', t1), ('t2', t2), ('old_t2', old_t2), ('a1', a1), ('a2', a2), ('a3', a3), ('a4', a4), ('att', att), ('q1', q1), ('q2', q2), ('y4', y4), ('y5', y5);
end $$;

-- Remember how the untouched things looked, to prove they didn't change.
create temp table before_state as
  select 'attempts' as k, md5(string_agg(to_jsonb(a)::text, ',' order by a.id::text)) as h from public.attempts a
  union all select 'answers', md5(string_agg(to_jsonb(a)::text, ',' order by a.attempt_id::text, a.question_id::text)) from public.attempt_answers a
  union all select 'windows', md5(string_agg(to_jsonb(w)::text, ',' order by w.id::text)) from public.exam_windows w;

-- Before: the preview script must run and report what is about to move.
\ir ../one-off/2026-11-27_1_preview.sql

-- ---- The move.
\ir ../one-off/2026-11-27_2_move_second_term_to_first_term.sql

do $$
declare t1 uuid := (select v from ids where k = 't1'); t2 uuid := (select v from ids where k = 't2');
begin
  -- Tests and questions moved; the ones already in First Term and last year's Second Term did not.
  if (select term_id from public.assessments where id = (select v from ids where k = 'a1')) <> t1 then raise exception 'draft not moved'; end if;
  if (select term_id from public.assessments where id = (select v from ids where k = 'a2')) <> t1 then raise exception 'approved test not moved'; end if;
  if (select term_id from public.assessments where id = (select v from ids where k = 'a3')) <> t1 then raise exception 'first-term test changed'; end if;
  if (select term_id from public.assessments where id = (select v from ids where k = 'a4')) <> (select v from ids where k = 'old_t2') then raise exception 'LAST YEAR''s second term was touched'; end if;
  if (select term_id from public.questions where id = (select v from ids where k = 'q1')) <> t1 then raise exception 'question not moved'; end if;
  if (select term_id from public.question_uploads where label = 'Second term bank') <> t1 then raise exception 'bank not moved'; end if;

  -- Edit times are exactly as they were (the database would normally have stamped "now").
  if (select updated_at from public.assessments where id = (select v from ids where k = 'a1')) <> '2026-01-05 10:00+00' then raise exception 'edit time changed on a test'; end if;
  if (select updated_at from public.assessments where id = (select v from ids where k = 'a2')) <> '2026-02-06 11:00+00' then raise exception 'edit time changed on an approved test'; end if;
  if (select updated_at from public.assessments where id = (select v from ids where k = 'a3')) <> '2026-03-07 12:00+00' then raise exception 'edit time changed on an untouched test'; end if;
  if (select updated_at from public.questions where id = (select v from ids where k = 'q1')) <> '2026-04-08 13:00+00' then raise exception 'edit time changed on a question'; end if;

  -- Results, answers and exam windows are exactly as they were, and now sit under First Term through their test.
  if exists (
    select 1 from before_state b join (
      select 'attempts' as k, md5(string_agg(to_jsonb(a)::text, ',' order by a.id::text)) as h from public.attempts a
      union all select 'answers', md5(string_agg(to_jsonb(a)::text, ',' order by a.attempt_id::text, a.question_id::text)) from public.attempt_answers a
      union all select 'windows', md5(string_agg(to_jsonb(w)::text, ',' order by w.id::text)) from public.exam_windows w) n on n.k = b.k
    where n.h <> b.h) then raise exception 'results, answers or exam windows changed'; end if;
  if (select s.term_id from public.attempts a join public.assessments s on s.id = a.assessment_id where a.id = (select v from ids where k = 'att')) <> t1 then
    raise exception 'the result did not follow its test to First Term'; end if;

  -- Exam calendar: the clashing year-4 date stayed; the year-5 date moved.
  if (select term_id from public.round_schedules where year_id = (select v from ids where k = 'y5') and term_id in (t1, t2)) <> t1 then raise exception 'year 5 date not moved'; end if;
  if (select count(*) from public.round_schedules where term_id = t2) <> 1 then raise exception 'the clashing date should have stayed in Second Term'; end if;
  if (select count(*) from public.round_schedules where term_id = t1 and year_id = (select v from ids where k = 'y4')) <> 1 then raise exception 'a clash overwrote the First Term date'; end if;

  -- Nothing left in Second Term except the one clashing date; every move is on record.
  if exists (select 1 from public.assessments where term_id = t2) or exists (select 1 from public.questions where term_id = t2) then raise exception 'something was left behind'; end if;
  if (select count(*) from public.term_move_log where undone_at is null) <> 5 then raise exception 'move log wrong: %', (select count(*) from public.term_move_log); end if;
  if not exists (select 1 from public.audit_log where action = 'term.records_moved') then raise exception 'not in the audit log'; end if;
  if (select count(*) from public.assessments a join public.term_move_log l on l.row_id = a.id and l.table_name = 'assessments') <> 2 then raise exception 'wrong tests logged'; end if;
end $$;

-- It refuses to run a second time.
select pg_temp.expect_error($q$ select pg_temp.move_second_term_to_first(null) $q$, 'already been done');

-- ---- Undo puts everything back, again without touching edit times.
\ir ../one-off/2026-11-27_3_undo_move.sql
do $$
declare t1 uuid := (select v from ids where k = 't1'); t2 uuid := (select v from ids where k = 't2');
begin
  if (select term_id from public.assessments where id = (select v from ids where k = 'a1')) <> t2 then raise exception 'undo: draft not restored'; end if;
  if (select term_id from public.assessments where id = (select v from ids where k = 'a2')) <> t2 then raise exception 'undo: approved test not restored'; end if;
  if (select term_id from public.assessments where id = (select v from ids where k = 'a3')) <> t1 then raise exception 'undo: moved a first-term test'; end if;
  if (select term_id from public.questions where id = (select v from ids where k = 'q1')) <> t2 then raise exception 'undo: question not restored'; end if;
  if (select term_id from public.question_uploads where label = 'Second term bank') <> t2 then raise exception 'undo: bank not restored'; end if;
  if (select count(*) from public.round_schedules where term_id = t2) <> 2 then raise exception 'undo: calendar not restored'; end if;
  if (select updated_at from public.assessments where id = (select v from ids where k = 'a1')) <> '2026-01-05 10:00+00' then raise exception 'undo changed an edit time'; end if;
  if exists (select 1 from public.term_move_log where undone_at is null) then raise exception 'undo left log rows open'; end if;
end $$;

-- ---- Guards. A term that is not called First/Second is refused.
update public.terms set name = 'Term B' where id = (select v from ids where k = 't2');
select pg_temp.expect_error($q$ select pg_temp.move_second_term_to_first(null) $q$, 'not First and Second Term');
update public.terms set name = 'Second Term' where id = (select v from ids where k = 't2');

-- The "nothing else changed" proof really works: if anything but the term would change, it stops and changes nothing.
create function public.test_sneaky() returns trigger language plpgsql as $$ begin new.title := new.title || ' (sneaky)'; return new; end $$;
create trigger test_sneaky before update on public.assessments for each row execute function public.test_sneaky();
select pg_temp.expect_error($q$ select pg_temp.move_second_term_to_first(null) $q$, 'A value other than the term would have changed');
drop trigger test_sneaky on public.assessments;
drop function public.test_sneaky();
do $$ begin
  if (select count(*) from public.assessments where term_id = (select v from ids where k = 't2')) <> 2 then raise exception 'a refused run moved something'; end if;
  if exists (select 1 from public.assessments where title like '%sneaky%') then raise exception 'a refused run changed data'; end if;
end $$;

-- After a refusal, with the trigger gone, it still works.
\ir ../one-off/2026-11-27_2_move_second_term_to_first_term.sql
do $$ begin
  if (select count(*) from public.assessments where term_id = (select v from ids where k = 't1')) <> 3 then raise exception 'second run did not move'; end if;
end $$;
rollback;
