-- Rounds become the one thing that organises questions and papers (1st CA, 2nd CA, Mid-Term, Exam…),
-- plus the agreed approval simplifications.
--
-- ADDITIVE ONLY. New nullable columns; no existing row is updated. Existing questions have no round
-- ("Not sorted yet") until a teacher sorts them; existing papers keep their round label
-- (assessments.sequence_label), which the app reads as the round until round_id is set.

-- ---------------------------------------------------------------------------
-- 1. Round settings (super admins for the whole school; Heads of Section for their own sections)
-- ---------------------------------------------------------------------------
alter table public.ca_round_configs
  -- 'test' or 'exam': sets the default number of questions, time and strictness. Null = guess from the label.
  add column kind text check (kind is null or kind in ('test', 'exam')),
  -- false for mocks and practice rounds: their results don't count towards the term record
  add column counts_to_result boolean not null default true,
  -- the sections this round is for; empty = every section (Elementary and College)
  add column section_ids uuid[] not null default '{}',
  -- optional defaults for papers in this round (null = the kind's default)
  add column question_count int check (question_count is null or question_count between 1 and 200),
  add column duration_minutes int check (duration_minutes is null or duration_minutes between 1 and 600),
  add column created_by uuid references public.staff (id) on delete set null;

-- Admins manage rounds, so they also see hidden ones.
create policy "Admins can read all ca round configs"
  on public.ca_round_configs for select to authenticated
  using (public.is_super_admin() or public.my_staff_role() = 'admin');

-- ---------------------------------------------------------------------------
-- 2. Where questions and papers belong
-- ---------------------------------------------------------------------------
alter table public.questions
  add column round_id uuid references public.ca_round_configs (id) on delete set null,
  add column term_id uuid references public.terms (id) on delete set null;
create index questions_round_idx on public.questions (subject_id, round_id, term_id) where not archived;

alter table public.assessments
  add column round_id uuid references public.ca_round_configs (id) on delete set null;
create index assessments_round_idx on public.assessments (subject_id, year_id, term_id, round_id);

alter table public.question_uploads
  add column round_id uuid references public.ca_round_configs (id) on delete set null,
  add column term_id uuid references public.terms (id) on delete set null;

-- Same function as before, now also recording the round and term on the upload and its questions.
create or replace function public.import_questions(p_upload jsonb, p_questions jsonb, p_link_existing uuid[] default '{}')
returns jsonb
language plpgsql security invoker set search_path = public
as $$
declare
  v_subject uuid := (p_upload->>'subject_id')::uuid;
  v_year uuid := nullif(p_upload->>'year_id', '')::uuid;
  v_assessment uuid := nullif(p_upload->>'assessment_id', '')::uuid;
  v_round uuid := nullif(p_upload->>'round_id', '')::uuid;
  v_term uuid := nullif(p_upload->>'term_id', '')::uuid;
  v_upload uuid;
  v_ids uuid[] := '{}';
  v_qid uuid;
  v_linked int := 0;
  v_pos int;
  q jsonb;
begin
  if v_assessment is not null then
    perform public._require(public.can_edit_assessment(v_assessment),
      'this test can no longer be changed (it has been submitted or approved), so nothing was saved');
    perform public._require(
      exists (select 1 from public.assessments where id = v_assessment and subject_id = v_subject),
      'this test is for a different subject');
  end if;
  if v_year is not null then
    perform public._require(
      exists (select 1 from public.years y join public.subjects s on s.section_id = y.section_id
              where y.id = v_year and s.id = v_subject),
      'that year group is not in the same section as the subject');
  end if;

  insert into public.question_uploads (
    owner_id, subject_id, year_id, assessment_id, round_id, term_id, label, file_name, source_format,
    found_count, duplicate_count, removed_count, unreadable_count, issues)
  values (
    auth.uid(), v_subject, v_year, v_assessment, v_round, v_term,
    left(trim(coalesce(nullif(trim(p_upload->>'label'), ''), 'Upload')), 80),
    left(p_upload->>'file_name', 200),
    p_upload->>'source_format',
    coalesce((p_upload->>'found_count')::int, 0),
    coalesce((p_upload->>'duplicate_count')::int, 0),
    coalesce((p_upload->>'removed_count')::int, 0),
    coalesce((p_upload->>'unreadable_count')::int, 0),
    coalesce(p_upload->'issues', '[]'::jsonb))
  returning id into v_upload;

  for q in select value from jsonb_array_elements(coalesce(p_questions, '[]'::jsonb)) loop
    insert into public.questions (subject_id, year_id, owner_id, upload_id, round_id, term_id, body, options, answer, topic, difficulty, explanation, image_url)
    values (
      v_subject, v_year, auth.uid(), v_upload, v_round, v_term,
      q->>'body', q->'options', q->>'answer',
      nullif(q->>'topic', ''), nullif(q->>'difficulty', '')::smallint,
      nullif(q->>'explanation', ''), nullif(q->>'image_url', ''))
    returning id into v_qid;
    v_ids := v_ids || v_qid;
  end loop;

  if v_assessment is not null then
    select coalesce(max(position), 0) into v_pos from public.assessment_questions where assessment_id = v_assessment;
    insert into public.assessment_questions (assessment_id, question_id, position)
    select v_assessment, x.id, v_pos + x.ord
    from unnest(v_ids || coalesce(p_link_existing, '{}')) with ordinality as x(id, ord)
    on conflict (assessment_id, question_id) do nothing;
    get diagnostics v_linked = row_count;
    v_linked := greatest(v_linked - cardinality(v_ids), 0);
  end if;

  update public.question_uploads
     set imported_count = cardinality(v_ids), linked_count = v_linked
   where id = v_upload;

  return jsonb_build_object('upload_id', v_upload, 'imported', cardinality(v_ids), 'linked', v_linked);
end $$;
grant execute on function public.import_questions(jsonb, jsonb, uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Reviewing: "Approve with a note", and "Needs changes" on an approved paper opens it for the
--    teacher straight away (no separate "Begin correction" step).
-- ---------------------------------------------------------------------------
create or replace function public.bulk_review(p_items jsonb)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  item jsonb;
  aid uuid;
  act text;
  cat text;
  note text;
  results jsonb := '[]'::jsonb;
begin
  for item in select * from jsonb_array_elements(p_items) loop
    aid := (item->>'id')::uuid;
    act := item->>'action';
    cat := nullif(trim(coalesce(item->>'category', '')), '');
    note := nullif(trim(coalesce(item->>'note', '')), '');
    begin
      if act = 'send_back' then
        perform public._require(note is not null, 'say what needs to change');
        perform public.review_assessment(aid, false, note);
      elsif act in ('approve', 'flag') then
        if act = 'flag' then
          perform public._require(cat in ('wrong_answers', 'duplicates', 'difficulty', 'typos', 'topic', 'other'), 'choose a reason for the flag');
        end if;
        perform public._require(
          not exists (
            select 1
            from public.assessment_questions aq
            join public.questions q on q.id = aq.question_id
            where aq.assessment_id = aid
              and (jsonb_array_length(q.options) < 2
                   or not exists (select 1 from jsonb_array_elements(q.options) o where o->>'key' = q.answer))
          ),
          'a question has no valid correct answer');
        -- An approval may carry a note for the teacher (no rework needed).
        perform public.review_assessment(aid, true, case when act = 'approve' then note else null end);
        if act = 'flag' then
          update public.assessments
             set flag_status = 'open', flag_category = cat, flag_note = note,
                 flagged_by = auth.uid(), flagged_at = now(), flag_resolved_at = null,
                 -- the teacher can start fixing it straight away, unless students have already sat it
                 amending = not exists (select 1 from public.attempts where assessment_id = aid),
                 corrections_submitted_at = null
           where id = aid;
          update public.exam_windows set auto_start = false where assessment_id = aid;
          perform public.log_audit('assessment.flag', 'assessment', aid::text, jsonb_build_object('category', cat, 'note', note));
        end if;
      else
        raise exception 'unknown action';
      end if;
      results := results || jsonb_build_object('id', aid, 'ok', true);
    exception when others then
      results := results || jsonb_build_object('id', aid, 'ok', false, 'error', sqlerrm);
    end;
  end loop;
  return results;
end $$;
grant execute on function public.bulk_review(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 4a. Finished attempts stay immutable, except when one of the two audited "continue" functions reopens
--     one. (Before this, the resume feature could never work: this guard refused every reopen.)
-- ---------------------------------------------------------------------------
create or replace function public.guard_attempts()
returns trigger language plpgsql as $$
begin
  if old.status <> 'in_progress' then
    -- Set (for this transaction only) by approve_resume / let_student_continue.
    if current_setting('cbt.reopen_attempt', true) = old.id::text and new.status = 'in_progress'
       and new.student_id = old.student_id and new.window_id = old.window_id
       and new.started_at = old.started_at and new.question_order = old.question_order then
      return new;
    end if;
    if new.status = 'in_progress' then
      raise exception 'a finished attempt cannot be reopened' using errcode = 'P0001';
    end if;
    if new.student_id <> old.student_id or new.window_id <> old.window_id
       or new.started_at <> old.started_at or new.submitted_at is distinct from old.submitted_at
       or new.question_order <> old.question_order then
      raise exception 'finished attempts are immutable' using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;

-- Same as before, plus the guard permission above.
create or replace function public.approve_resume(p_request uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  r            public.resume_requests;
  w            public.exam_windows;
  new_deadline timestamptz;
begin
  select * into r from public.resume_requests where id = p_request for update;
  perform public._require(found, 'request not found');
  perform public._require(r.status = 'pending', 'already processed');

  select * into w from public.exam_windows where id = r.window_id;
  perform public._require(
    public.admin_of_section(public.section_of_class(w.class_id)) and public.has_perm('exam.start'),
    'permission denied');

  new_deadline := now() + make_interval(mins => r.extra_minutes);

  perform set_config('cbt.reopen_attempt', r.attempt_id::text, true);
  update public.attempts
     set status = 'in_progress', deadline = new_deadline, submitted_at = null, submit_source = null,
         score = null, max_score = null, answered_count = null, correct_count = null,
         login_method = 'resume', terminal_id = null
   where id = r.attempt_id;
  perform set_config('cbt.reopen_attempt', '', true);

  insert into public.exam_exceptions (window_id, student_id, kind, reason, granted_by)
  values (r.window_id, r.student_id, 'relogin_unlock', 'Resume approved', auth.uid());

  update public.exam_windows
     set ends_at = greatest(ends_at, new_deadline + interval '5 minutes'),
         status  = case when status = 'closed' then 'live' else status end
   where id = r.window_id;

  update public.resume_requests
     set status = 'approved', approved_by = auth.uid(), approved_at = now()
   where id = p_request;

  perform public.log_audit('resume.approved', 'exam_window', w.id::text,
    jsonb_build_object('student_id', r.student_id, 'extra_minutes', r.extra_minutes, 'new_deadline', new_deadline));
end $$;

-- ---------------------------------------------------------------------------
-- 4. Let a student continue after running out of time: one action by one person with the
--    extra-time permission (replaces allocate → request → approve). Everything is audited.
-- ---------------------------------------------------------------------------
create or replace function public.let_student_continue(p_window uuid, p_student uuid, p_minutes int, p_reason text)
returns timestamptz
language plpgsql security definer set search_path = public
as $$
declare
  w public.exam_windows;
  t public.attempts;
  new_deadline timestamptz;
begin
  select * into w from public.exam_windows where id = p_window for update;
  perform public._require(found, 'exam not found');
  perform public._require(
    public.admin_of_section(public.section_of_class(w.class_id)) and public.has_perm('exam.extend_time'),
    'you do not have permission to give extra time for this class');
  perform public._require(p_minutes between 1 and 180, 'give between 1 and 180 minutes');
  perform public._require(length(trim(coalesce(p_reason, ''))) > 0, 'say why, for the record');

  select * into t from public.attempts
   where window_id = p_window and student_id = p_student and status = 'submitted'
   order by created_at desc limit 1 for update;
  perform public._require(found, 'this student has no finished attempt to continue');

  new_deadline := now() + make_interval(mins => p_minutes);

  insert into public.exam_exceptions (window_id, student_id, kind, extra_minutes, reason, granted_by)
  values (p_window, p_student, 'extra_time', p_minutes, trim(p_reason), auth.uid());

  perform set_config('cbt.reopen_attempt', t.id::text, true);
  update public.attempts
     set status = 'in_progress', deadline = new_deadline, submitted_at = null, submit_source = null,
         score = null, max_score = null, answered_count = null, correct_count = null,
         login_method = 'resume', terminal_id = null
   where id = t.id;
  perform set_config('cbt.reopen_attempt', '', true);

  -- may log in on any lab computer
  insert into public.exam_exceptions (window_id, student_id, kind, reason, granted_by)
  values (p_window, p_student, 'relogin_unlock', 'Allowed to continue: ' || trim(p_reason), auth.uid());

  update public.exam_windows
     set ends_at = greatest(ends_at, new_deadline + interval '5 minutes'),
         status = case when status = 'closed' then 'live' else status end
   where id = p_window;

  -- kept in the same history as two-step resumes
  insert into public.resume_requests (window_id, attempt_id, student_id, extra_minutes, status, requested_by, approved_by, approved_at)
  values (p_window, t.id, p_student, p_minutes, 'approved', auth.uid(), auth.uid(), now());

  perform public.log_audit('resume.approved', 'exam_window', p_window::text,
    jsonb_build_object('student_id', p_student, 'extra_minutes', p_minutes, 'reason', trim(p_reason), 'one_step', true));
  return new_deadline;
end $$;
grant execute on function public.let_student_continue(uuid, uuid, int, text) to authenticated;
