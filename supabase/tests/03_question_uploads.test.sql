-- Question uploads: all-or-nothing import, duplicates linked into the test, permissions. Rolled back.
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
  coll uuid := (select id from public.sections where code = 'COLL');
  y4 uuid := (select id from public.years where section_id = elem and level = 4);
  ycoll uuid := (select id from public.years where section_id = coll order by level limit 1);
  bio uuid := (select id from public.subjects where section_id = elem and name = 'Basic Science');
  cls uuid;
  t1 uuid := gen_random_uuid(); t2 uuid := gen_random_uuid();
  aid uuid; done uuid;
begin
  insert into auth.users (id, email) values (t1, 't1@lps.test'), (t2, 't2@lps.test');
  insert into public.staff (id, school_id, email, full_name, role) values
    (t1, sch, 't1@lps.test', 'Teacher One', 'teacher'), (t2, sch, 't2@lps.test', 'Teacher Two', 'teacher');
  insert into public.classes (year_id, name) values (y4, 'Year 4 Upload') returning id into cls;
  insert into public.teaching_assignments (teacher_id, subject_id, class_id, session_id, status)
  values (t1, bio, cls, (select id from public.academic_sessions where is_current), 'approved');
  insert into public.assessments (subject_id, year_id, term_id, title, type, question_count, duration_minutes, created_by)
  values (bio, y4, (select id from public.terms where is_current), 'Draft test', 'test', 5, 20, t1) returning id into aid;
  insert into public.assessments (subject_id, year_id, term_id, title, type, question_count, duration_minutes, created_by, status, submitted_at)
  values (bio, y4, (select id from public.terms where is_current), 'Submitted test', 'test', 5, 20, t1, 'pending_approval', now()) returning id into done;
  insert into ids values ('t1', t1), ('t2', t2), ('bio', bio), ('y4', y4), ('ycoll', ycoll), ('aid', aid), ('done', done);
end $$;

-- A question already in the bank (the "duplicate").
select pg_temp.act_as((select v from ids where k = 't1'));
insert into public.questions (subject_id, year_id, owner_id, body, options, answer)
values ((select v from ids where k = 'bio'), (select v from ids where k = 'y4'), (select v from ids where k = 't1'),
        'Existing', '[{"key":"A","text":"x"},{"key":"B","text":"y"}]', 'A');
insert into ids select 'existing', id from public.questions where body = 'Existing';

-- Import 2 new questions into the draft test, plus link the existing one.
do $$
declare r jsonb;
begin
  r := public.import_questions(
    jsonb_build_object('subject_id', (select v from ids where k = 'bio'), 'year_id', (select v from ids where k = 'y4'),
      'assessment_id', (select v from ids where k = 'aid'), 'label', '1st CA', 'file_name', 'ca1.docx', 'source_format', 'word',
      'found_count', 4, 'duplicate_count', 1, 'unreadable_count', 1,
      'issues', '[{"code":"NO_ANSWER","source":"question 4","message":"The answer is missing."}]'::jsonb),
    '[{"body":"New 1","options":[{"key":"A","text":"a"},{"key":"B","text":"b"}],"answer":"B","topic":"Cells","difficulty":2},
      {"body":"New 2","options":[{"key":"A","text":"a"},{"key":"B","text":"b"}],"answer":"A"}]'::jsonb,
    array[(select v from ids where k = 'existing')]);
  if (r->>'imported')::int <> 2 then raise exception 'expected 2 imported, got %', r; end if;
  if (r->>'linked')::int <> 1 then raise exception 'expected 1 linked, got %', r; end if;
  if (select count(*) from public.questions where upload_id = (r->>'upload_id')::uuid) <> 2 then raise exception 'questions not tagged with upload'; end if;
  if (select count(*) from public.assessment_questions where assessment_id = (select v from ids where k = 'aid')) <> 3 then raise exception 'test should have 3 questions'; end if;
  if (select string_agg(q.body, ',' order by aq.position) from public.assessment_questions aq join public.questions q on q.id = aq.question_id
      where aq.assessment_id = (select v from ids where k = 'aid')) <> 'New 1,New 2,Existing' then raise exception 'wrong order'; end if;
  if (select imported_count from public.question_uploads where id = (r->>'upload_id')::uuid) <> 2 then raise exception 'receipt not updated'; end if;
  if (select difficulty from public.questions where body = 'New 1') <> 2 then raise exception 'difficulty lost'; end if;
end $$;

-- Into a submitted test: refused, and NOTHING is saved (no upload row, no questions).
select pg_temp.expect_error($q$
  select public.import_questions(
    jsonb_build_object('subject_id', (select v from ids where k = 'bio'), 'assessment_id', (select v from ids where k = 'done'), 'label', 'late'),
    '[{"body":"Late","options":[{"key":"A","text":"a"},{"key":"B","text":"b"}],"answer":"A"}]'::jsonb)
$q$, 'can no longer be changed');
do $$ begin
  if exists (select 1 from public.questions where body = 'Late') then raise exception 'partial save'; end if;
  if exists (select 1 from public.question_uploads where label = 'late') then raise exception 'orphan upload'; end if;
end $$;

-- A bad question part-way through rolls back the whole upload.
select pg_temp.expect_error($q$
  select public.import_questions(
    jsonb_build_object('subject_id', (select v from ids where k = 'bio'), 'label', 'half'),
    '[{"body":"Fine","options":[{"key":"A","text":"a"},{"key":"B","text":"b"}],"answer":"A"},
      {"body":"Bad","options":[{"key":"A","text":"a"},{"key":"B","text":"b"}],"answer":"Z"}]'::jsonb)
$q$, 'questions_answer_check');
do $$ begin
  if exists (select 1 from public.questions where body = 'Fine') then raise exception 'partial save after bad question'; end if;
end $$;

-- A year group from another section is refused.
select pg_temp.expect_error($q$
  select public.import_questions(
    jsonb_build_object('subject_id', (select v from ids where k = 'bio'), 'year_id', (select v from ids where k = 'ycoll'), 'label', 'wrong year'),
    '[]'::jsonb)
$q$, 'same section');

-- A teacher who doesn't teach the subject can't upload into it.
select pg_temp.act_as((select v from ids where k = 't2'));
select pg_temp.expect_error($q$
  select public.import_questions(jsonb_build_object('subject_id', (select v from ids where k = 'bio'), 'label', 'x'), '[]'::jsonb)
$q$, 'row-level security');

-- Deleting an upload keeps its questions (they just lose the upload tag).
select pg_temp.act_as((select v from ids where k = 't1'));
delete from public.question_uploads where label = '1st CA';
do $$ begin
  if (select count(*) from public.questions where body in ('New 1', 'New 2') and upload_id is null) <> 2 then
    raise exception 'questions should survive their upload record';
  end if;
end $$;

rollback;
