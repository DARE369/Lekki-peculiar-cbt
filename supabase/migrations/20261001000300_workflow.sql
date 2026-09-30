-- Workflow functions. Every state change that matters goes through one of these so the rules
-- (who may do what, when an exam is open, when answers lock) live in one place and are audited.

-- ---------------------------------------------------------------------------
-- Exam window state
-- ---------------------------------------------------------------------------
-- scheduled       — before start time
-- awaiting_start  — start time reached, but an admin still has to press Start
-- live            — students may start
-- paused          — admin paused: no new starts (running attempts keep their clock)
-- closed          — admin closed or end time passed
create or replace function public.window_state(w public.exam_windows, at timestamptz default now())
returns text
language sql stable
as $$
  select case
    when w.status = 'closed' or at > w.ends_at then 'closed'
    when w.status = 'paused' then 'paused'
    when w.status = 'live' then 'live'
    when at < w.starts_at then 'scheduled'
    when w.auto_start then 'live'
    else 'awaiting_start'
  end
$$;

create or replace function public._require(cond boolean, msg text)
returns void language plpgsql as $$
begin
  if not coalesce(cond, false) then
    raise exception '%', msg using errcode = '42501';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Grading
-- ---------------------------------------------------------------------------
create or replace function public.grade_attempt(p_attempt uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  t public.attempts;
  a public.assessments;
  marks numeric;
  n_answered int;
  n_correct int;
  n_total int;
begin
  select * into t from public.attempts where id = p_attempt;
  if not found or t.status = 'in_progress' then return; end if;
  select * into a from public.assessments where id = t.assessment_id;
  marks := coalesce((a.settings ->> 'marks_per_question')::numeric, 1);

  with ord as (
    select x ->> 'q' as qid from jsonb_array_elements(t.question_order) x
  ), keyed as (
    select e ->> 'id' as qid, e ->> 'answer' as ans from jsonb_array_elements(a.paper -> 'questions') e
  )
  select count(*),
         count(*) filter (where aa.selected is not null),
         count(*) filter (where aa.selected = keyed.ans)
    into n_total, n_answered, n_correct
  from ord
  join keyed using (qid)
  left join public.attempt_answers aa on aa.attempt_id = t.id and aa.question_id::text = ord.qid;

  update public.attempts
     set total_questions = n_total,
         answered_count = n_answered,
         correct_count = n_correct,
         score = n_correct * marks,
         max_score = n_total * marks
   where id = t.id;
end $$;

-- Finalise attempts whose owners never came back (browser closed, PC died) once their upload
-- grace period is over. Safe to call often; the app calls it before showing monitors/reports.
create or replace function public.finalize_expired_attempts()
returns int
language plpgsql security definer set search_path = public
as $$
declare
  r record;
  n int := 0;
begin
  for r in
    select t.id, t.deadline
    from public.attempts t
    join public.exam_windows w on w.id = t.window_id
    where t.status = 'in_progress'
      and now() > t.deadline + make_interval(mins => w.sync_cutoff_minutes)
    for update of t skip locked
  loop
    update public.attempts
       set status = 'submitted', submitted_at = r.deadline, submit_source = 'auto_finalize'
     where id = r.id;
    perform public.grade_attempt(r.id);
    n := n + 1;
  end loop;
  return n;
end $$;

-- ---------------------------------------------------------------------------
-- Teacher → admin approval flow
-- ---------------------------------------------------------------------------
create or replace function public.submit_assessment(p_assessment uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  a public.assessments;
  pool int;
begin
  select * into a from public.assessments where id = p_assessment for update;
  perform public._require(found, 'assessment not found');
  perform public._require(
    a.created_by = auth.uid() or public.admin_of_section(public.section_of_subject(a.subject_id)),
    'not allowed');
  perform public._require(a.status in ('draft', 'changes_requested'), 'only drafts can be submitted');
  select count(*) into pool from public.assessment_questions where assessment_id = a.id;
  perform public._require(pool >= a.question_count,
    format('this assessment needs at least %s questions; it has %s', a.question_count, pool));

  update public.assessments set status = 'pending_approval', submitted_at = now() where id = a.id;
  perform public.log_audit('assessment.submit', 'assessment', a.id::text, null);
end $$;

-- Reopen an approved/pending assessment for editing (drops the frozen paper). Blocked once
-- anyone has sat it.
create or replace function public.reopen_assessment(p_assessment uuid, p_note text)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  a public.assessments;
begin
  select * into a from public.assessments where id = p_assessment for update;
  perform public._require(found, 'assessment not found');
  perform public._require(
    (a.created_by = auth.uid() and a.status = 'pending_approval')
    or (public.admin_of_section(public.section_of_subject(a.subject_id)) and public.has_perm('exam.approve')),
    'not allowed');
  perform public._require(not exists (select 1 from public.attempts where assessment_id = a.id),
    'students have already sat this assessment; it can no longer be edited');
  delete from public.exam_windows where assessment_id = a.id;
  update public.assessments
     set status = 'changes_requested', paper = null, review_note = coalesce(p_note, review_note)
   where id = a.id;
  perform public.log_audit('assessment.reopen', 'assessment', a.id::text, jsonb_build_object('note', p_note));
end $$;

create or replace function public.review_assessment(p_assessment uuid, p_approve boolean, p_note text default null)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  a public.assessments;
  frozen jsonb;
begin
  select * into a from public.assessments where id = p_assessment for update;
  perform public._require(found, 'assessment not found');
  perform public._require(
    public.admin_of_section(public.section_of_subject(a.subject_id)) and public.has_perm('exam.approve'),
    'you do not have permission to approve assessments in this section');
  perform public._require(a.status = 'pending_approval', 'assessment is not awaiting approval');

  if not p_approve then
    update public.assessments
       set status = 'changes_requested', reviewed_by = auth.uid(), reviewed_at = now(), review_note = p_note
     where id = a.id;
    perform public.log_audit('assessment.request_changes', 'assessment', a.id::text, jsonb_build_object('note', p_note));
    return;
  end if;

  select jsonb_build_object(
           'questions', jsonb_agg(jsonb_build_object(
               'id', q.id, 'body', q.body, 'options', q.options, 'answer', q.answer,
               'image_url', q.image_url, 'topic', q.topic, 'explanation', q.explanation
             ) order by aq.position, q.created_at),
           'frozen_at', now())
    into frozen
  from public.assessment_questions aq
  join public.questions q on q.id = aq.question_id
  where aq.assessment_id = a.id;

  update public.assessments
     set status = 'approved', paper = frozen, reviewed_by = auth.uid(), reviewed_at = now(), review_note = p_note
   where id = a.id;
  perform public.log_audit('assessment.approve', 'assessment', a.id::text, jsonb_build_object('note', p_note));
end $$;

-- Create or move an exam window (date/time for one class). Admin with exam.approve only.
create or replace function public.schedule_window(
  p_assessment uuid, p_class uuid, p_starts timestamptz, p_ends timestamptz, p_auto_start boolean default false
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  a public.assessments;
  w public.exam_windows;
  wid uuid;
begin
  select * into a from public.assessments where id = p_assessment;
  perform public._require(found, 'assessment not found');
  perform public._require(a.status = 'approved', 'approve the assessment before scheduling it');
  perform public._require(
    public.admin_of_section(public.section_of_class(p_class)) and public.has_perm('exam.approve'),
    'you do not have permission to schedule exams for this class');
  perform public._require(p_ends > p_starts, 'end time must be after start time');
  perform public._require(
    exists (select 1 from public.classes where id = p_class and year_id = a.year_id),
    'that class is not in the year group this assessment was written for');

  select * into w from public.exam_windows where assessment_id = a.id and class_id = p_class;
  if found then
    perform public._require(public.window_state(w) in ('scheduled', 'awaiting_start'),
      'this exam has already started; use Extend time instead of rescheduling');
    update public.exam_windows
       set starts_at = p_starts, ends_at = p_ends, auto_start = p_auto_start
     where id = w.id;
    wid := w.id;
  else
    insert into public.exam_windows (assessment_id, class_id, starts_at, ends_at, auto_start, created_by)
    values (a.id, p_class, p_starts, p_ends, p_auto_start, auth.uid())
    returning id into wid;
  end if;
  perform public.log_audit('window.schedule', 'exam_window', wid::text,
    jsonb_build_object('class_id', p_class, 'starts_at', p_starts, 'ends_at', p_ends, 'auto_start', p_auto_start));
  return wid;
end $$;

create or replace function public.delete_window(p_window uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  w public.exam_windows;
begin
  select * into w from public.exam_windows where id = p_window;
  perform public._require(found, 'window not found');
  perform public._require(
    public.admin_of_section(public.section_of_class(w.class_id)) and public.has_perm('exam.approve'), 'not allowed');
  perform public._require(not exists (select 1 from public.attempts where window_id = w.id),
    'students have already started this exam; close it instead');
  delete from public.exam_windows where id = w.id;
  perform public.log_audit('window.delete', 'exam_window', w.id::text, null);
end $$;

-- Start / pause / resume / close. "Start" works early (starts now) and after the scheduled
-- end if a new end time is supplied.
create or replace function public.window_action(p_window uuid, p_action text, p_ends_at timestamptz default null)
returns text
language plpgsql security definer set search_path = public
as $$
declare
  w public.exam_windows;
  a public.assessments;
begin
  select * into w from public.exam_windows where id = p_window for update;
  perform public._require(found, 'window not found');
  perform public._require(
    public.admin_of_section(public.section_of_class(w.class_id)) and public.has_perm('exam.start'),
    'you do not have permission to start or stop exams for this class');
  select * into a from public.assessments where id = w.assessment_id;
  perform public._require(a.status = 'approved', 'assessment is not approved');

  if p_action in ('start', 'resume') then
    if p_ends_at is not null then
      perform public._require(p_ends_at > now(), 'new end time must be in the future');
      w.ends_at := p_ends_at;
    end if;
    perform public._require(w.ends_at > now(), 'the end time has passed; give a new end time to reopen');
    update public.exam_windows
       set status = 'live',
           starts_at = least(starts_at, now()),
           ends_at = w.ends_at,
           started_by = coalesce(started_by, auth.uid()),
           started_at = coalesce(started_at, now()),
           closed_at = null
     where id = w.id;
  elsif p_action = 'pause' then
    update public.exam_windows set status = 'paused' where id = w.id;
  elsif p_action = 'close' then
    update public.exam_windows set status = 'closed', closed_at = now() where id = w.id;
  else
    raise exception 'unknown action %', p_action;
  end if;

  perform public.log_audit('window.' || p_action, 'exam_window', w.id::text,
    case when p_ends_at is null then null else jsonb_build_object('ends_at', p_ends_at) end);
  select * into w from public.exam_windows where id = p_window;
  return public.window_state(w);
end $$;

-- Extra time for a whole class (p_student null) or one student.
create or replace function public.extend_time(p_window uuid, p_minutes int, p_student uuid, p_reason text)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  w public.exam_windows;
begin
  select * into w from public.exam_windows where id = p_window for update;
  perform public._require(found, 'window not found');
  perform public._require(
    public.admin_of_section(public.section_of_class(w.class_id)) and public.has_perm('exam.extend_time'),
    'you do not have permission to extend time');
  perform public._require(p_minutes between 1 and 240, 'extra time must be between 1 and 240 minutes');
  perform public._require(length(trim(coalesce(p_reason, ''))) > 0, 'a reason is required');

  if p_student is null then
    update public.exam_windows
       set extra_minutes = extra_minutes + p_minutes,
           ends_at = greatest(ends_at, now()) + make_interval(mins => p_minutes)
     where id = w.id;
    update public.attempts
       set deadline = deadline + make_interval(mins => p_minutes)
     where window_id = w.id and status = 'in_progress';
  else
    insert into public.exam_exceptions (window_id, student_id, kind, extra_minutes, reason, granted_by, consumed_at)
    values (w.id, p_student, 'extra_time', p_minutes, p_reason, auth.uid(), null);
    update public.attempts
       set deadline = deadline + make_interval(mins => p_minutes)
     where window_id = w.id and student_id = p_student and status = 'in_progress';
  end if;
  perform public.log_audit('window.extend_time', 'exam_window', w.id::text,
    jsonb_build_object('minutes', p_minutes, 'student_id', p_student, 'reason', p_reason));
end $$;

-- Make-up: lets a student (e.g. absent on the day) start this exam in a new time slot.
create or replace function public.grant_makeup(
  p_window uuid, p_student uuid, p_opens timestamptz, p_closes timestamptz, p_reason text
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  w public.exam_windows;
  eid uuid;
begin
  select * into w from public.exam_windows where id = p_window;
  perform public._require(found, 'window not found');
  perform public._require(
    public.admin_of_section(public.section_of_class(w.class_id)) and public.has_perm('exam.grant_makeup'),
    'you do not have permission to grant make-up exams');
  perform public._require(p_closes > p_opens and p_closes > now(), 'the make-up slot must end in the future');
  perform public._require(length(trim(coalesce(p_reason, ''))) > 0, 'a reason is required');
  perform public._require(
    not exists (select 1 from public.attempts where window_id = w.id and student_id = p_student and status <> 'voided'),
    'this student already has an attempt; void it first if they should retake');

  insert into public.exam_exceptions (window_id, student_id, kind, opens_at, closes_at, reason, granted_by)
  values (w.id, p_student, 'makeup', p_opens, p_closes, p_reason, auth.uid())
  returning id into eid;
  perform public.log_audit('exception.makeup', 'exam_window', w.id::text,
    jsonb_build_object('student_id', p_student, 'opens_at', p_opens, 'closes_at', p_closes, 'reason', p_reason));
  return eid;
end $$;

-- Let a student continue on a different computer (their original PC failed).
create or replace function public.unlock_relogin(p_window uuid, p_student uuid, p_reason text)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  w public.exam_windows;
begin
  select * into w from public.exam_windows where id = p_window;
  perform public._require(found, 'window not found');
  perform public._require(
    public.admin_of_section(public.section_of_class(w.class_id)) and public.has_perm('attempt.unlock'),
    'you do not have permission to unlock re-logins');
  insert into public.exam_exceptions (window_id, student_id, kind, reason, granted_by)
  values (w.id, p_student, 'relogin_unlock', coalesce(nullif(trim(p_reason), ''), 'Unlocked by invigilator'), auth.uid());
  perform public.log_audit('exception.relogin_unlock', 'exam_window', w.id::text,
    jsonb_build_object('student_id', p_student, 'reason', p_reason));
end $$;

create or replace function public.void_attempt(p_attempt uuid, p_reason text)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  t public.attempts;
begin
  select * into t from public.attempts where id = p_attempt for update;
  perform public._require(found, 'attempt not found');
  perform public._require(
    public.admin_of_section(public.section_of_class(t.class_id)) and public.has_perm('attempt.void'),
    'you do not have permission to void attempts');
  perform public._require(length(trim(coalesce(p_reason, ''))) > 0, 'a reason is required');
  perform public._require(t.status <> 'voided', 'already voided');
  update public.attempts
     set status = 'voided', voided_by = auth.uid(), voided_reason = p_reason,
         submitted_at = coalesce(submitted_at, now()), submit_source = coalesce(submit_source, 'admin')
   where id = t.id;
  perform public.log_audit('attempt.void', 'attempt', t.id::text, jsonb_build_object('reason', p_reason));
end $$;

-- Fix a wrong answer key after an exam and regrade everybody who sat it.
create or replace function public.correct_answer_key(p_assessment uuid, p_question uuid, p_answer text)
returns int
language plpgsql security definer set search_path = public
as $$
declare
  a public.assessments;
  r record;
  n int := 0;
  old_answer text;
begin
  select * into a from public.assessments where id = p_assessment for update;
  perform public._require(found, 'assessment not found');
  perform public._require(
    a.created_by = auth.uid() or public.admin_of_section(public.section_of_subject(a.subject_id)),
    'not allowed');
  perform public._require(p_answer ~ '^[A-F]$', 'answer must be a letter A-F');
  perform public._require(a.paper is not null, 'assessment has no frozen paper');
  perform public._require(
    exists (select 1 from jsonb_array_elements(a.paper -> 'questions') q, jsonb_array_elements(q -> 'options') o
            where q ->> 'id' = p_question::text and o ->> 'key' = p_answer),
    'that option does not exist on this question');

  select q ->> 'answer' into old_answer
  from jsonb_array_elements(a.paper -> 'questions') q where q ->> 'id' = p_question::text;

  update public.assessments
     set paper = jsonb_set(paper, '{questions}', (
           select jsonb_agg(case when q ->> 'id' = p_question::text
                                 then jsonb_set(q, '{answer}', to_jsonb(p_answer)) else q end
                            order by i)
           from jsonb_array_elements(paper -> 'questions') with ordinality x(q, i)))
   where id = a.id;
  update public.questions set answer = p_answer where id = p_question;

  for r in select id from public.attempts where assessment_id = a.id and status = 'submitted' loop
    perform public.grade_attempt(r.id);
    n := n + 1;
  end loop;
  perform public.log_audit('assessment.correct_key', 'assessment', a.id::text,
    jsonb_build_object('question_id', p_question, 'from', old_answer, 'to', p_answer, 'regraded', n));
  return n;
end $$;

create or replace function public.decide_assignment(p_assignment uuid, p_approve boolean)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  ta public.teaching_assignments;
begin
  select * into ta from public.teaching_assignments where id = p_assignment for update;
  perform public._require(found, 'assignment not found');
  perform public._require(
    public.admin_of_section(public.section_of_class(ta.class_id)) and public.has_perm('teachers.manage'),
    'you do not have permission to approve teaching assignments for this class');
  update public.teaching_assignments
     set status = case when p_approve then 'approved' else 'rejected' end,
         decided_by = auth.uid(), decided_at = now()
   where id = ta.id;
  perform public.log_audit(case when p_approve then 'assignment.approve' else 'assignment.reject' end,
    'teaching_assignment', ta.id::text, null);
end $$;

create or replace function public.set_current_term(p_term uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  sid uuid;
  sch uuid;
begin
  perform public._require(public.is_super_admin(), 'only the super admin can change the current term');
  select t.session_id, s.school_id into sid, sch
  from public.terms t join public.academic_sessions s on s.id = t.session_id where t.id = p_term;
  perform public._require(sid is not null, 'term not found');
  update public.terms set is_current = (id = p_term)
   where session_id in (select id from public.academic_sessions where school_id = sch);
  update public.academic_sessions set is_current = (id = sid) where school_id = sch;
  perform public.log_audit('term.set_current', 'term', p_term::text, null);
end $$;

-- ---------------------------------------------------------------------------
-- Student exam functions (service role only — called by the exam terminal API)
-- ---------------------------------------------------------------------------

-- What the terminal needs to render and resume an attempt. Never includes the answer key.
create or replace function public._exam_payload(p_attempt uuid)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  t public.attempts;
  a public.assessments;
  subj text;
  qs jsonb;
  ans jsonb;
begin
  select * into t from public.attempts where id = p_attempt;
  select * into a from public.assessments where id = t.assessment_id;
  select name into subj from public.subjects where id = a.subject_id;

  select jsonb_agg(jsonb_build_object(
           'id', q ->> 'id',
           'body', q ->> 'body',
           'image_url', q ->> 'image_url',
           'options', (
             select jsonb_agg(jsonb_build_object(
                      'key', k,
                      'text', (select o ->> 'text' from jsonb_array_elements(q -> 'options') o where o ->> 'key' = k))
                    order by ki)
             from jsonb_array_elements_text(x.ord -> 'o') with ordinality y(k, ki))
         ) order by x.oi)
    into qs
  from jsonb_array_elements(t.question_order) with ordinality x(ord, oi)
  join lateral (
    select e as q from jsonb_array_elements(a.paper -> 'questions') e where e ->> 'id' = x.ord ->> 'q'
  ) qq on true;

  select coalesce(jsonb_agg(jsonb_build_object(
           'q', question_id, 's', selected, 'f', flagged, 'at', answered_at)), '[]'::jsonb)
    into ans
  from public.attempt_answers where attempt_id = t.id;

  return jsonb_build_object(
    'attempt', jsonb_build_object(
      'id', t.id, 'status', t.status, 'started_at', t.started_at, 'deadline', t.deadline,
      'window_id', t.window_id, 'is_makeup', t.is_makeup),
    'assessment', jsonb_build_object(
      'id', a.id, 'title', a.title, 'type', a.type, 'subject', subj,
      'duration_minutes', a.duration_minutes, 'question_count', jsonb_array_length(t.question_order),
      'settings', a.settings - 'pass_mark'),
    'questions', qs,
    'answers', ans,
    'server_now', now());
end $$;

-- Result shown to the student after submitting, depending on the teacher's setting.
create or replace function public._exam_result(p_attempt uuid)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  t public.attempts;
  a public.assessments;
  mode text;
  review jsonb;
begin
  select * into t from public.attempts where id = p_attempt;
  select * into a from public.assessments where id = t.assessment_id;
  mode := coalesce(a.settings ->> 'show_result', 'score');
  if mode = 'none' or t.status <> 'submitted' then
    return jsonb_build_object('status', t.status, 'show', 'none');
  end if;
  if mode = 'full' then
    select jsonb_agg(jsonb_build_object(
             'q', x.ord ->> 'q',
             's', aa.selected,
             'a', (select e ->> 'answer' from jsonb_array_elements(a.paper -> 'questions') e where e ->> 'id' = x.ord ->> 'q'))
           order by x.oi)
      into review
    from jsonb_array_elements(t.question_order) with ordinality x(ord, oi)
    left join public.attempt_answers aa on aa.attempt_id = t.id and aa.question_id::text = x.ord ->> 'q';
  end if;
  return jsonb_build_object(
    'status', t.status, 'show', mode,
    'score', t.score, 'max_score', t.max_score,
    'correct', t.correct_count, 'answered', t.answered_count, 'total', t.total_questions,
    'review', review);
end $$;

-- Exams a student can see right now (their class's windows today + their make-ups).
create or replace function public.exam_available(p_student uuid)
returns jsonb
language sql stable security definer set search_path = public
as $$
  with s as (select * from public.students where id = p_student and active),
  wins as (
    select w.id, false as makeup, null::timestamptz as mk_opens, null::timestamptz as mk_closes
    from public.exam_windows w, s
    where w.class_id = s.class_id
      and w.starts_at < now() + interval '12 hours'
      and w.ends_at > now() - interval '12 hours'
    union all
    select e.window_id, true, e.opens_at, e.closes_at
    from public.exam_exceptions e
    join s on s.id = e.student_id
    where e.kind = 'makeup' and e.closes_at > now() and e.opens_at < now() + interval '12 hours'
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'window_id', w.id,
      'title', a.title,
      'type', a.type,
      'subject', sub.name,
      'duration_minutes', a.duration_minutes,
      'question_count', a.question_count,
      'instructions', a.settings ->> 'instructions',
      'starts_at', coalesce(wins.mk_opens, w.starts_at),
      'ends_at', coalesce(wins.mk_closes, w.ends_at),
      'is_makeup', wins.makeup,
      'state', case
                 when wins.makeup then case when now() < wins.mk_opens then 'scheduled' else 'live' end
                 else public.window_state(w)
               end,
      'attempt_status', (select t.status from public.attempts t
                         where t.window_id = w.id and t.student_id = p_student and t.status <> 'voided')
    ) order by coalesce(wins.mk_opens, w.starts_at)), '[]'::jsonb)
  from wins
  join public.exam_windows w on w.id = wins.id
  join public.assessments a on a.id = w.assessment_id and a.status = 'approved'
  join public.subjects sub on sub.id = a.subject_id
$$;

create or replace function public.exam_start(p_student uuid, p_window uuid, p_terminal uuid, p_method text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  s public.students;
  w public.exam_windows;
  a public.assessments;
  t public.attempts;
  unlock_id uuid;
  is_makeup boolean := false;
  st text;
  n int;
  pool int;
  shuffle_q boolean;
  shuffle_o boolean;
  q_order jsonb;
  extra int;
begin
  select * into s from public.students where id = p_student and active;
  if not found then return jsonb_build_object('error', 'student_not_found'); end if;
  select * into w from public.exam_windows where id = p_window;
  if not found then return jsonb_build_object('error', 'exam_not_found'); end if;
  select * into a from public.assessments where id = w.assessment_id;
  if a.status <> 'approved' or a.paper is null then return jsonb_build_object('error', 'exam_not_found'); end if;

  -- Resume an existing attempt
  select * into t from public.attempts
   where window_id = w.id and student_id = s.id and status <> 'voided' for update;
  if found then
    if t.status = 'submitted' then
      return jsonb_build_object('error', 'already_submitted');
    end if;
    if t.terminal_id is distinct from p_terminal then
      select id into unlock_id from public.exam_exceptions
       where window_id = w.id and student_id = s.id and kind = 'relogin_unlock' and consumed_at is null
       order by created_at desc limit 1;
      if unlock_id is null then
        update public.attempts set relogins = relogins + 1 where id = t.id;
        insert into public.attempt_events (attempt_id, student_id, terminal_id, type, detail)
        values (t.id, s.id, p_terminal, 'blocked_other_terminal', jsonb_build_object('method', p_method));
        return jsonb_build_object('error', 'locked_other_terminal');
      end if;
      update public.exam_exceptions set consumed_at = now() where id = unlock_id;
      update public.attempts set terminal_id = p_terminal, relogins = relogins + 1 where id = t.id;
      insert into public.attempt_events (attempt_id, student_id, terminal_id, type, detail)
      values (t.id, s.id, p_terminal, 'relogin_unlocked', jsonb_build_object('method', p_method));
    else
      insert into public.attempt_events (attempt_id, student_id, terminal_id, type, detail)
      values (t.id, s.id, p_terminal, 'resumed', jsonb_build_object('method', p_method));
    end if;
    return public._exam_payload(t.id);
  end if;

  -- New attempt: is the student allowed to start now?
  st := public.window_state(w);
  if s.class_id = w.class_id and st = 'live' then
    is_makeup := false;
  elsif exists (select 1 from public.exam_exceptions
                 where window_id = w.id and student_id = s.id and kind = 'makeup'
                   and now() between opens_at and closes_at) then
    is_makeup := true;
  else
    return jsonb_build_object('error', case when s.class_id <> w.class_id then 'not_your_class' else 'exam_' || st end);
  end if;

  n := a.question_count;
  pool := jsonb_array_length(a.paper -> 'questions');
  shuffle_q := coalesce((a.settings ->> 'shuffle_questions')::boolean, true);
  shuffle_o := coalesce((a.settings ->> 'shuffle_options')::boolean, true);

  select jsonb_agg(jsonb_build_object('q', p.q ->> 'id', 'o', p.opts) order by p.ord)
    into q_order
  from (
    select picked.q,
           case when shuffle_q then random() else picked.i::float8 end as ord,
           (select jsonb_agg(o ->> 'key' order by case when shuffle_o then random() else oi::float8 end)
              from jsonb_array_elements(picked.q -> 'options') with ordinality z(o, oi)) as opts
    from (
      select e.q, e.i
      from jsonb_array_elements(a.paper -> 'questions') with ordinality e(q, i)
      order by case when pool > n then random() else e.i::float8 end
      limit n
    ) picked
  ) p;

  select coalesce(sum(extra_minutes), 0) into extra from public.exam_exceptions
   where window_id = w.id and student_id = s.id and kind = 'extra_time';

  insert into public.attempts (
    window_id, assessment_id, student_id, class_id, is_makeup, login_method, terminal_id,
    question_order, deadline, total_questions)
  values (
    w.id, a.id, s.id, s.class_id, is_makeup, p_method, p_terminal,
    q_order, now() + make_interval(mins => a.duration_minutes + w.extra_minutes + extra), jsonb_array_length(q_order))
  returning * into t;

  if is_makeup then
    update public.exam_exceptions set consumed_at = now()
     where window_id = w.id and student_id = s.id and kind = 'makeup' and consumed_at is null;
  end if;

  insert into public.attempt_events (attempt_id, student_id, terminal_id, type, detail)
  values (t.id, s.id, p_terminal, 'started', jsonb_build_object('method', p_method, 'makeup', is_makeup));

  return public._exam_payload(t.id);
end $$;

-- Store a batch of answers (and integrity events) from the terminal.
-- p_answers: [{ "q": uuid, "s": "A"|null, "f": bool, "at": timestamptz (server-clock estimate) }]
-- p_events:  [{ "type": "focus_lost"|"fullscreen_exit"|..., "at": timestamptz, "detail": {} }]
create or replace function public.exam_sync(p_attempt uuid, p_answers jsonb, p_events jsonb default '[]'::jsonb)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  t public.attempts;
  cutoff int;
  accepted int := 0;
  offered int := 0;
  focus int := 0;
begin
  select * into t from public.attempts where id = p_attempt for update;
  if not found then return jsonb_build_object('error', 'attempt_not_found'); end if;
  if t.status <> 'in_progress' then
    return jsonb_build_object('status', t.status, 'deadline', t.deadline, 'server_now', now());
  end if;
  select sync_cutoff_minutes into cutoff from public.exam_windows where id = t.window_id;

  if now() > t.deadline + make_interval(mins => cutoff) then
    perform public.finalize_expired_attempts();
    select * into t from public.attempts where id = p_attempt;
    return jsonb_build_object('status', t.status, 'deadline', t.deadline, 'server_now', now());
  end if;

  offered := coalesce(jsonb_array_length(p_answers), 0);
  insert into public.attempt_answers (attempt_id, question_id, selected, flagged, answered_at)
  select t.id, (e ->> 'q')::uuid, nullif(e ->> 's', ''), coalesce((e ->> 'f')::boolean, false),
         least((e ->> 'at')::timestamptz, now())
  from jsonb_array_elements(coalesce(p_answers, '[]'::jsonb)) e
  where (e ->> 'at')::timestamptz <= t.deadline + interval '30 seconds'
    and (e ->> 's' is null or e ->> 's' ~ '^[A-F]$')
    and exists (select 1 from jsonb_array_elements(t.question_order) o where o ->> 'q' = e ->> 'q')
  on conflict (attempt_id, question_id) do update
    set selected = excluded.selected, flagged = excluded.flagged,
        answered_at = excluded.answered_at, received_at = now()
    where excluded.answered_at >= public.attempt_answers.answered_at;
  get diagnostics accepted = row_count;

  insert into public.attempt_events (attempt_id, student_id, terminal_id, type, detail)
  select t.id, t.student_id, t.terminal_id, left(ev ->> 'type', 40),
         coalesce(ev -> 'detail', '{}'::jsonb) || jsonb_build_object('at', ev ->> 'at')
  from jsonb_array_elements(coalesce(p_events, '[]'::jsonb)) ev
  where ev ->> 'type' is not null;
  select count(*) into focus from jsonb_array_elements(coalesce(p_events, '[]'::jsonb)) ev
   where ev ->> 'type' in ('focus_lost', 'fullscreen_exit');

  update public.attempts
     set last_sync_at = now(),
         focus_losses = focus_losses + focus,
         late_sync = late_sync or (offered > 0 and now() > deadline + interval '2 minutes')
   where id = t.id;

  return jsonb_build_object(
    'status', 'in_progress', 'deadline', t.deadline, 'server_now', now(),
    'accepted', accepted, 'rejected', offered - accepted);
end $$;

create or replace function public.exam_submit(
  p_attempt uuid, p_answers jsonb, p_events jsonb default '[]'::jsonb, p_source text default 'student'
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  t public.attempts;
  a public.assessments;
  sync jsonb;
  missing int;
begin
  sync := public.exam_sync(p_attempt, p_answers, p_events);
  if sync ? 'error' then return sync; end if;

  select * into t from public.attempts where id = p_attempt for update;
  if t.status = 'in_progress' then
    select * into a from public.assessments where id = t.assessment_id;
    -- Enforce "answer every question" on the server too (not for timeouts).
    if p_source = 'student' and coalesce((a.settings ->> 'require_all_answered')::boolean, false) then
      select count(*) into missing
      from jsonb_array_elements(t.question_order) o
      where not exists (select 1 from public.attempt_answers aa
                         where aa.attempt_id = t.id and aa.question_id::text = o ->> 'q' and aa.selected is not null);
      if missing > 0 and now() < t.deadline then
        return jsonb_build_object('error', 'unanswered', 'missing', missing);
      end if;
    end if;
    update public.attempts
       set status = 'submitted',
           submitted_at = least(now(), deadline + interval '30 seconds'),
           submit_source = case when p_source in ('student', 'timeout') then p_source else 'student' end
     where id = t.id;
    insert into public.attempt_events (attempt_id, student_id, terminal_id, type, detail)
    values (t.id, t.student_id, t.terminal_id, 'submitted', jsonb_build_object('source', p_source));
    perform public.grade_attempt(t.id);
  end if;
  return public._exam_result(p_attempt);
end $$;

-- ---------------------------------------------------------------------------
-- Execution rights: nothing for anonymous callers; exam functions for the server only.
-- ---------------------------------------------------------------------------
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated, service_role;

revoke execute on function public.grade_attempt(uuid) from authenticated;
revoke execute on function public._exam_payload(uuid) from authenticated;
revoke execute on function public._exam_result(uuid) from authenticated;
revoke execute on function public.exam_available(uuid) from authenticated;
revoke execute on function public.exam_start(uuid, uuid, uuid, text) from authenticated;
revoke execute on function public.exam_sync(uuid, jsonb, jsonb) from authenticated;
revoke execute on function public.exam_submit(uuid, jsonb, jsonb, text) from authenticated;
