-- Resume Attempts
-- Allows admins to re-open a submitted attempt so a student can continue with
-- already-allocated extra time. Two steps: request → approve.

-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------
create table public.resume_requests (
  id          uuid primary key default gen_random_uuid(),
  window_id   uuid not null references public.exam_windows(id) on delete cascade,
  attempt_id  uuid not null references public.attempts(id) on delete cascade,
  student_id  uuid not null references public.students(id) on delete cascade,
  status      text not null default 'pending'
                check (status in ('pending', 'approved', 'rejected')),
  extra_minutes int not null default 0,
  requested_by uuid references public.staff(id) on delete set null,
  requested_at timestamptz not null default now(),
  approved_by  uuid references public.staff(id) on delete set null,
  approved_at  timestamptz
);

create index resume_requests_window_idx on public.resume_requests (window_id, student_id);
create index resume_requests_pending_idx on public.resume_requests (status) where status = 'pending';

alter table public.resume_requests enable row level security;
create policy "staff can manage resume requests"
  on public.resume_requests for all using (public.is_staff());

-- ---------------------------------------------------------------------------
-- RPC: request_resume
-- Validates that extra time has been allocated, then creates a pending request.
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- RPC: approve_resume
-- Re-opens the attempt with a new deadline = now + extra_minutes.
-- Also inserts a relogin_unlock so the student can log in from any terminal.
-- ---------------------------------------------------------------------------
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

  -- Re-open the attempt: clear scoring data, set fresh deadline, mark as resume
  update public.attempts
     set status        = 'in_progress',
         deadline      = new_deadline,
         submitted_at  = null,
         submit_source = null,
         score         = null,
         max_score     = null,
         answered_count = null,
         correct_count  = null,
         login_method  = 'resume',
         terminal_id   = null
   where id = r.attempt_id;

  -- Grant a relogin_unlock so the student can enter from any computer
  insert into public.exam_exceptions (window_id, student_id, kind, reason, granted_by)
  values (r.window_id, r.student_id, 'relogin_unlock', 'Resume approved', auth.uid());

  -- Extend the window's end time if needed so finalize_expired_attempts won't
  -- immediately kill the re-opened attempt
  update public.exam_windows
     set ends_at = greatest(ends_at, new_deadline + interval '5 minutes'),
         -- Re-open a closed window to live so the student can enter
         status  = case when status = 'closed' then 'live' else status end
   where id = r.window_id;

  -- Mark request approved
  update public.resume_requests
     set status      = 'approved',
         approved_by = auth.uid(),
         approved_at = now()
   where id = p_request;

  perform public.log_audit('resume.approved', 'exam_window', w.id::text,
    jsonb_build_object('student_id', r.student_id, 'extra_minutes', r.extra_minutes,
                       'new_deadline', new_deadline));
end $$;
