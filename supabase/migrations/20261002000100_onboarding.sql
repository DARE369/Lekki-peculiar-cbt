-- Staff onboarding: contact phone, first-time setup, question deadlines, and question upload
-- while a teacher's subject request is still waiting for approval.

-- ---------------------------------------------------------------------------
-- Staff
-- ---------------------------------------------------------------------------
alter table public.staff
  add column phone text,
  -- Set when the person finishes the first-time setup screens.
  add column onboarded_at timestamptz,
  -- True until the person chooses their own password (temporary passwords and invitations).
  add column needs_password boolean not null default true;

-- Existing accounts already have a way to sign in, so they aren't asked for a new password.
-- Everyone except super admins sees the setup screens once (so their phone number is collected).
update public.staff set needs_password = false;
update public.staff set onboarded_at = now() where role = 'super_admin';

-- ---------------------------------------------------------------------------
-- Question deadlines and targets
-- ---------------------------------------------------------------------------
alter table public.schools
  -- Default deadline for every teacher to finish uploading questions.
  add column question_deadline date,
  -- How many questions each teacher should upload per subject and year group.
  add column questions_per_subject integer not null default 40 check (questions_per_subject between 1 and 500);

-- A section deadline (e.g. College) overrides the school's default for that section's subjects.
alter table public.sections add column question_deadline date;

-- ---------------------------------------------------------------------------
-- Question bank: teachers may add questions as soon as they have asked to teach a subject
-- (option "upload while waiting"). The questions stay theirs; the subject's shared bank still
-- needs an approved assignment to read other teachers' questions.
-- ---------------------------------------------------------------------------
create or replace function public.requested_or_teaches_subject(subj uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.teaching_assignments
    where teacher_id = auth.uid() and subject_id = subj and status in ('requested', 'approved')
  )
$$;

drop policy questions_insert on public.questions;
create policy questions_insert on public.questions for insert to authenticated
  with check (
    owner_id = auth.uid()
    and (public.requested_or_teaches_subject(subject_id) or public.admin_of_section(public.section_of_subject(subject_id)))
  );

-- ---------------------------------------------------------------------------
-- Upload progress: for each teacher, subject and year group they asked to teach this session,
-- how many questions they have put in the bank. Teachers see their own rows; Heads of Section
-- see their sections; super admins see everything.
-- ---------------------------------------------------------------------------
create or replace function public.upload_progress(p_teacher uuid default null)
returns table (
  teacher_id uuid,
  subject_id uuid,
  year_id uuid,
  approved boolean,
  class_ids uuid[],
  questions integer
)
language sql stable security definer set search_path = public
as $$
  select ta.teacher_id,
         ta.subject_id,
         c.year_id,
         bool_or(ta.status = 'approved') as approved,
         array_agg(ta.class_id order by c.name) as class_ids,
         (select count(*)::int from public.questions q
           where q.owner_id = ta.teacher_id and q.subject_id = ta.subject_id
             and q.year_id = c.year_id and not q.archived) as questions
  from public.teaching_assignments ta
  join public.classes c on c.id = ta.class_id
  join public.academic_sessions s on s.id = ta.session_id and s.is_current
  join public.staff t on t.id = ta.teacher_id
  where ta.status in ('requested', 'approved')
    and t.school_id = public.my_school_id()
    and (p_teacher is null or ta.teacher_id = p_teacher)
    and (ta.teacher_id = auth.uid() or public.admin_of_section(public.section_of_subject(ta.subject_id)))
  group by ta.teacher_id, ta.subject_id, c.year_id
$$;
grant execute on function public.upload_progress(uuid) to authenticated;
