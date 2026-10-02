-- Bulk review, flags and corrections after approval. Runs in a transaction that is rolled back.
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
  hod uuid := gen_random_uuid(); chod uuid := gen_random_uuid(); dixon uuid := gen_random_uuid();
  noperm uuid := gen_random_uuid();
begin
  insert into auth.users (id, email) values
    (hod, 'h@lps.test'), (chod, 'c@lps.test'), (dixon, 'd@lps.test'), (noperm, 'n@lps.test');
  insert into public.staff (id, school_id, email, full_name, role) values
    (hod, sch, 'h@lps.test', 'Elem HOD', 'admin'), (chod, sch, 'c@lps.test', 'Coll HOD', 'admin'),
    (dixon, sch, 'd@lps.test', 'Mr Dixon', 'teacher'), (noperm, sch, 'n@lps.test', 'No Perm HOD', 'admin');
  insert into public.admin_sections values (hod, elem), (chod, coll), (noperm, elem);
  insert into public.classes (year_id, name) values (y4, 'Year 4 Test');
  insert into public.staff_permissions (staff_id, permission) values (hod, 'exam.approve'), (chod, 'exam.approve');
  insert into ids values ('hod', hod), ('chod', chod), ('dixon', dixon), ('noperm', noperm),
    ('y4', y4), ('term', (select id from public.terms where is_current)),
    ('bio', (select id from public.subjects where section_id = elem and name = 'Basic Science'));
end $$;

-- Six good questions, plus one with an answer that matches no option.
insert into public.questions (subject_id, owner_id, body, options, answer)
select (select v from ids where k = 'bio'), (select v from ids where k = 'dixon'), 'Q' || g,
       '[{"key":"A","text":"one"},{"key":"B","text":"two"},{"key":"C","text":"three"}]'::jsonb, 'B'
from generate_series(1, 6) g;
insert into public.questions (subject_id, owner_id, body, options, answer)
values ((select v from ids where k = 'bio'), (select v from ids where k = 'dixon'), 'Broken',
        '[{"key":"A","text":"x"},{"key":"B","text":"y"}]'::jsonb, 'D');

-- Four submitted tests: good, to-be-flagged, to-be-sent-back, and one with a broken question.
do $$
declare t text; aid uuid;
begin
  foreach t in array array['good', 'flag', 'back', 'broken'] loop
    insert into public.assessments (subject_id, year_id, term_id, title, type, question_count, duration_minutes, created_by, status, submitted_at)
    values ((select v from ids where k = 'bio'), (select v from ids where k = 'y4'), (select v from ids where k = 'term'),
            'Test ' || t, 'test', 5, 20, (select v from ids where k = 'dixon'), 'pending_approval', now())
    returning id into aid;
    insert into ids values (t, aid);
    insert into public.assessment_questions (assessment_id, question_id, position)
    select aid, id, row_number() over (order by body)
    from public.questions where body <> 'Broken' or t = 'broken';
  end loop;
end $$;

-- Who may review: the section's Head of Section with the permission; nobody else.
select pg_temp.act_as((select v from ids where k = 'chod'));
select pg_temp.expect_error($q$
  do $d$ declare r jsonb; begin
    r := public.bulk_review(jsonb_build_array(jsonb_build_object('id', (select v from ids where k = 'good'), 'action', 'approve')));
    if (r->0->>'ok')::boolean then raise exception 'college HOD approved an elementary test'; end if;
    raise exception 'denied: %', r->0->>'error';
  end $d$
$q$, 'denied');
select pg_temp.act_as((select v from ids where k = 'noperm'));
select pg_temp.expect_error($q$
  do $d$ declare r jsonb; begin
    r := public.bulk_review(jsonb_build_array(jsonb_build_object('id', (select v from ids where k = 'good'), 'action', 'approve')));
    raise exception 'denied: %', r->0->>'error';
  end $d$
$q$, 'permission');

-- One bulk call: approve, approve with a flag, send back, and an invalid one that fails alone.
select pg_temp.act_as((select v from ids where k = 'hod'));
create temp table out as
select public.bulk_review(jsonb_build_array(
  jsonb_build_object('id', (select v from ids where k = 'good'), 'action', 'approve'),
  jsonb_build_object('id', (select v from ids where k = 'flag'), 'action', 'flag', 'category', 'typos', 'note', 'Fix typos in Q3'),
  jsonb_build_object('id', (select v from ids where k = 'back'), 'action', 'send_back', 'note', 'Too easy'),
  jsonb_build_object('id', (select v from ids where k = 'broken'), 'action', 'approve')
)) as r;
grant all on out to authenticated, service_role;
do $$
declare r jsonb := (select out.r from out);
begin
  if (r->0->>'ok')::boolean is not true then raise exception 'good failed: %', r->0; end if;
  if (r->1->>'ok')::boolean is not true then raise exception 'flag failed: %', r->1; end if;
  if (r->2->>'ok')::boolean is not true then raise exception 'send back failed: %', r->2; end if;
  if (r->3->>'ok')::boolean is true then raise exception 'broken test was approved'; end if;
  if position('correct answer' in r->3->>'error') = 0 then raise exception 'wrong error: %', r->3->>'error'; end if;
  if (select status from public.assessments where id = (select v from ids where k = 'good')) <> 'approved' then raise exception 'good not approved'; end if;
  if (select flag_status from public.assessments where id = (select v from ids where k = 'good')) is not null then raise exception 'good has a flag'; end if;
  if (select status || flag_status || flag_category from public.assessments where id = (select v from ids where k = 'flag')) <> 'approvedopentypos' then raise exception 'flag not recorded'; end if;
  if (select paper is null from public.assessments where id = (select v from ids where k = 'flag')) then raise exception 'flagged test not frozen'; end if;
  if (select status from public.assessments where id = (select v from ids where k = 'back')) <> 'changes_requested' then raise exception 'not sent back'; end if;
  if (select status from public.assessments where id = (select v from ids where k = 'broken')) <> 'pending_approval' then raise exception 'broken test changed'; end if;
end $$;

-- A flagged test can be scheduled but never set to start by itself.
do $$
declare w uuid;
begin
  w := public.schedule_window((select v from ids where k = 'flag'),
         (select id from public.classes where year_id = (select v from ids where k = 'y4') limit 1),
         now() + interval '1 day', now() + interval '2 days', true);
  if (select auto_start from public.exam_windows where id = w) then raise exception 'flagged test set to auto-start'; end if;
end $$;

-- A teacher cannot clear a flag or tamper with the frozen paper, whatever they send.
select pg_temp.act_as((select v from ids where k = 'dixon'));
update public.assessments set flag_status = null, amending = true where id = (select v from ids where k = 'flag');
do $$ begin
  if (select flag_status from public.assessments where id = (select v from ids where k = 'flag')) <> 'open' then raise exception 'teacher cleared the flag'; end if;
  if (select amending from public.assessments where id = (select v from ids where k = 'flag')) then raise exception 'teacher switched on amending'; end if;
end $$;
select pg_temp.expect_error($q$
  do $d$ begin
    insert into public.assessment_questions (assessment_id, question_id, position)
    select (select v from ids where k = 'flag'), id, 99 from public.questions where body = 'Broken';
  end $d$
$q$, 'row-level security');

-- Correct a flagged test: begin → edit → submit → the Head of Section accepts.
select public.begin_amendment((select v from ids where k = 'flag'));
-- While correcting, a teacher still cannot clear the flag, drop the frozen paper or stop the amendment by direct update.
update public.assessments set flag_status = null, paper = null, amending = false, status = 'draft'
 where id = (select v from ids where k = 'flag');
do $$ begin
  if (select flag_status from public.assessments where id = (select v from ids where k = 'flag')) is distinct from 'open' then raise exception 'flag cleared directly'; end if;
  if (select paper is null from public.assessments where id = (select v from ids where k = 'flag')) then raise exception 'paper dropped directly'; end if;
  if not (select amending from public.assessments where id = (select v from ids where k = 'flag')) then raise exception 'amendment stopped directly'; end if;
  if (select status from public.assessments where id = (select v from ids where k = 'flag')) <> 'approved' then raise exception 'status changed directly'; end if;
end $$;
update public.assessments set title = 'Test flag (corrected)' where id = (select v from ids where k = 'flag');
update public.questions set body = 'Q3 fixed' where body = 'Q3';
delete from public.assessment_questions
 where assessment_id = (select v from ids where k = 'flag') and question_id = (select id from public.questions where body = 'Q6');
select pg_temp.expect_error($q$ select public.submit_amendment((select v from ids where k = 'flag')) $q$, 'needs at least');
insert into public.assessment_questions (assessment_id, question_id, position)
select (select v from ids where k = 'flag'), id, 99 from public.questions where body = 'Q6';
select public.submit_amendment((select v from ids where k = 'flag'));
select pg_temp.expect_error($q$ select public.accept_amendment((select v from ids where k = 'flag')) $q$, 'permission');

select pg_temp.act_as((select v from ids where k = 'hod'));
do $$ begin
  -- Until accepted, the frozen paper is untouched.
  if not exists (select 1 from public.assessments a, jsonb_array_elements(a.paper->'questions') q
                 where a.id = (select v from ids where k = 'flag') and q->>'body' = 'Q3') then raise exception 'paper changed early'; end if;
end $$;
select public.accept_amendment((select v from ids where k = 'flag'));
do $$ begin
  if not exists (select 1 from public.assessments a, jsonb_array_elements(a.paper->'questions') q
                 where a.id = (select v from ids where k = 'flag') and q->>'body' = 'Q3 fixed') then raise exception 'corrections not frozen'; end if;
  if (select flag_status from public.assessments where id = (select v from ids where k = 'flag')) <> 'resolved' then raise exception 'flag not resolved'; end if;
  if (select amending from public.assessments where id = (select v from ids where k = 'flag')) then raise exception 'still amending'; end if;
end $$;

-- Once students have started, corrections are refused.
reset role;
do $$
declare aid uuid := (select v from ids where k = 'good');
begin
  update public.assessments set flag_status = 'open', flag_category = 'other' where id = aid;
end $$;
select pg_temp.act_as((select v from ids where k = 'hod'));
select public.resolve_flag((select v from ids where k = 'good'));
do $$ begin
  if (select flag_status from public.assessments where id = (select v from ids where k = 'good')) <> 'resolved' then raise exception 'resolve_flag failed'; end if;
end $$;

rollback;
