-- Marks: per question (halves allowed) or "test out of N", to one decimal place. Rolled back.
begin;
create temp table ids (k text primary key, v uuid);
do $$
declare
  sch uuid := (select id from public.schools limit 1);
  elem uuid := (select id from public.sections where code = 'ELEM');
  y4 uuid := (select id from public.years where section_id = elem and level = 4);
  bio uuid := (select id from public.subjects where section_id = elem and name = 'Basic Science');
  t uuid := gen_random_uuid(); cls uuid; stu uuid; aid uuid; wid uuid; att uuid;
  q1 uuid := gen_random_uuid(); q2 uuid := gen_random_uuid(); q3 uuid := gen_random_uuid();
begin
  insert into auth.users (id, email) values (t, 't5@lps.test');
  insert into public.staff (id, school_id, email, full_name, role) values (t, sch, 't5@lps.test', 'T5', 'teacher');
  insert into public.classes (year_id, name) values (y4, 'Year 4 Marks') returning id into cls;
  insert into public.students (school_id, admission_no, first_name, last_name, class_id) values (sch, 'M5/1', 'Ola', 'Five', cls) returning id into stu;
  insert into public.assessments (subject_id, year_id, term_id, title, type, question_count, duration_minutes, created_by, status, paper, settings)
  values (bio, y4, (select id from public.terms where is_current), 'Marks', 'test', 3, 20, t, 'approved',
    jsonb_build_object('questions', jsonb_build_array(
      jsonb_build_object('id', q1, 'answer', 'A'), jsonb_build_object('id', q2, 'answer', 'B'), jsonb_build_object('id', q3, 'answer', 'C'))),
    '{"marks_mode":"total","total_marks":20}') returning id into aid;
  insert into public.exam_windows (assessment_id, class_id, starts_at, ends_at, status)
  values (aid, cls, now() - interval '1 hour', now() + interval '1 hour', 'live') returning id into wid;
  insert into public.attempts (window_id, assessment_id, student_id, class_id, status, question_order, deadline, total_questions)
  values (wid, aid, stu, cls, 'in_progress',
    jsonb_build_array(jsonb_build_object('q', q1), jsonb_build_object('q', q2), jsonb_build_object('q', q3)), now() + interval '20 minutes', 3)
  returning id into att;
  insert into public.attempt_answers (attempt_id, question_id, selected, answered_at) values (att, q1, 'A', now()), (att, q2, 'B', now()), (att, q3, 'D', now());
  update public.attempts set status = 'submitted', submitted_at = now() where id = att;
  insert into ids values ('aid', aid), ('att', att);
end $$;

-- Out of 20, 2 of 3 right: 13.3 / 20.
select public.grade_attempt((select v from ids where k = 'att'));
do $$ begin
  if (select score from public.attempts where id = (select v from ids where k = 'att')) <> 13.3 then raise exception 'total mode score %', (select score from public.attempts where id = (select v from ids where k = 'att')); end if;
  if (select max_score from public.attempts where id = (select v from ids where k = 'att')) <> 20 then raise exception 'total mode max'; end if;
end $$;

-- Half a mark per question: 1.0 / 1.5.
update public.assessments set settings = '{"marks_mode":"per_question","marks_per_question":0.5}' where id = (select v from ids where k = 'aid');
select public.grade_attempt((select v from ids where k = 'att'));
do $$ begin
  if (select score from public.attempts where id = (select v from ids where k = 'att')) <> 1.0 then raise exception 'per-question score'; end if;
  if (select max_score from public.attempts where id = (select v from ids where k = 'att')) <> 1.5 then raise exception 'per-question max'; end if;
end $$;

-- Old settings (whole marks, no mode) still grade as before: 2 marks each → 4 / 6.
update public.assessments set settings = '{"marks_per_question":2}' where id = (select v from ids where k = 'aid');
select public.grade_attempt((select v from ids where k = 'att'));
do $$ begin
  if (select score from public.attempts where id = (select v from ids where k = 'att')) <> 4 then raise exception 'legacy score'; end if;
end $$;
rollback;
