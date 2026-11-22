-- Letting a student continue (or approving an old request) only works for a day after the exam closed.
-- Before this, a request left pending for weeks could still be approved, which reopened a finished exam
-- and cleared that student's score.
--
-- ADDITIVE ONLY: replaces three functions with the same signatures plus one check. No row is changed;
-- old pending requests simply can no longer be approved, and the app shows them as expired.

create or replace function public.request_resume(p_window uuid, p_student uuid)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  w   public.exam_windows;
  t   public.attempts;
  extra_total int;
  rid uuid;
begin
  select * into w from public.exam_windows where id = p_window;
  perform public._require(found, 'window not found');
  perform public._require(
    public.admin_of_section(public.section_of_class(w.class_id)) and public.has_perm('exam.start'),
    'permission denied');
  -- Only on the day: once an exam has been closed for a day, its results stand. (A make-up exam is the way after that.)
  perform public._require(w.ends_at > now() - interval '24 hours',
    'this exam closed more than a day ago, so students can no longer continue it. Give a make-up exam instead');


  -- Total extra minutes = per-window global + per-student exceptions
  select coalesce(w.extra_minutes, 0)
       + coalesce((
           select sum(e.extra_minutes)
             from public.exam_exceptions e
            where e.window_id = p_window
              and e.student_id = p_student
              and e.kind = 'extra_time'
         ), 0)
    into extra_total;

  perform public._require(extra_total > 0, 'no_extra_time');

  -- Must have a submitted attempt to re-open
  select * into t
    from public.attempts
   where window_id = p_window
     and student_id = p_student
     and status = 'submitted'
   order by created_at desc
   limit 1;
  perform public._require(found, 'no submitted attempt for this student');

  -- Replace any existing pending request with a fresh one
  delete from public.resume_requests
   where window_id = p_window and student_id = p_student and status = 'pending';

  insert into public.resume_requests
    (window_id, attempt_id, student_id, extra_minutes, requested_by)
  values
    (p_window, t.id, p_student, extra_total, auth.uid())
  returning id into rid;

  perform public.log_audit('resume.requested', 'exam_window', p_window::text,
    jsonb_build_object('student_id', p_student, 'attempt_id', t.id, 'extra_minutes', extra_total));

  return rid;
end $$;

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
  -- Only on the day: once an exam has been closed for a day, its results stand. (A make-up exam is the way after that.)
  perform public._require(w.ends_at > now() - interval '24 hours',
    'this exam closed more than a day ago, so students can no longer continue it. Give a make-up exam instead');


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
  -- Only on the day: once an exam has been closed for a day, its results stand. (A make-up exam is the way after that.)
  perform public._require(w.ends_at > now() - interval '24 hours',
    'this exam closed more than a day ago, so students can no longer continue it. Give a make-up exam instead');

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
