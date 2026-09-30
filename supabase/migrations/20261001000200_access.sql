-- Access helpers and row-level security.
--
-- Staff use the app with their own Supabase session, so every read and write below is checked
-- by RLS. Students never talk to the database directly: the exam terminal calls server route
-- handlers, which use the service role and the exam_* functions in the next migration.

-- ---------------------------------------------------------------------------
-- Helper functions (security definer so policies can call them without recursion)
-- ---------------------------------------------------------------------------
create or replace function public.my_staff_role()
returns public.staff_role
language sql stable security definer set search_path = public
as $$ select role from public.staff where id = auth.uid() and active $$;

create or replace function public.my_school_id()
returns uuid
language sql stable security definer set search_path = public
as $$ select school_id from public.staff where id = auth.uid() and active $$;

create or replace function public.is_staff()
returns boolean
language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.staff where id = auth.uid() and active) $$;

create or replace function public.is_super_admin()
returns boolean
language sql stable security definer set search_path = public
as $$ select coalesce(public.my_staff_role() = 'super_admin', false) $$;

create or replace function public.has_perm(p text)
returns boolean
language sql stable security definer set search_path = public
as $$
  select public.is_super_admin()
      or exists (
        select 1 from public.staff_permissions sp
        join public.staff s on s.id = sp.staff_id and s.active
        where sp.staff_id = auth.uid() and sp.permission = p
      )
$$;

-- Admins act only inside their sections; super admins everywhere.
create or replace function public.admin_of_section(sec uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select public.is_super_admin()
      or (public.my_staff_role() = 'admin'
          and exists (select 1 from public.admin_sections where staff_id = auth.uid() and section_id = sec))
$$;

create or replace function public.section_of_class(cls uuid)
returns uuid
language sql stable security definer set search_path = public
as $$ select y.section_id from public.classes c join public.years y on y.id = c.year_id where c.id = cls $$;

create or replace function public.section_of_subject(subj uuid)
returns uuid
language sql stable security definer set search_path = public
as $$ select section_id from public.subjects where id = subj $$;

create or replace function public.teaches_subject(subj uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.teaching_assignments
    where teacher_id = auth.uid() and subject_id = subj and status = 'approved'
  )
$$;

create or replace function public.teaches(subj uuid, cls uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.teaching_assignments
    where teacher_id = auth.uid() and subject_id = subj and class_id = cls and status = 'approved'
  )
$$;

create or replace function public.teaches_class(cls uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.teaching_assignments
    where teacher_id = auth.uid() and class_id = cls and status = 'approved'
  )
$$;

-- Can the current user see / manage this assessment?
create or replace function public.can_view_assessment(aid uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.assessments a
    where a.id = aid and (
      a.created_by = auth.uid()
      or public.teaches_subject(a.subject_id)
      or public.admin_of_section(public.section_of_subject(a.subject_id))
    )
  )
$$;

create or replace function public.can_edit_assessment(aid uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.assessments a
    where a.id = aid
      and a.status in ('draft', 'changes_requested')
      and (a.created_by = auth.uid() or public.admin_of_section(public.section_of_subject(a.subject_id)))
  )
$$;

-- Can the current user see results of this attempt? Teachers: subject + class they teach.
create or replace function public.can_view_attempt(att uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.attempts t
    join public.assessments a on a.id = t.assessment_id
    where t.id = att and (
      public.admin_of_section(public.section_of_subject(a.subject_id))
      or public.teaches(a.subject_id, t.class_id)
      or a.created_by = auth.uid()
    )
  )
$$;

create or replace function public.log_audit(p_action text, p_entity text, p_entity_id text, p_detail jsonb default null)
returns void
language sql security definer set search_path = public
as $$
  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (auth.uid(), p_action, p_entity, p_entity_id, p_detail)
$$;

-- ---------------------------------------------------------------------------
-- Lock down defaults: nothing for anonymous users, RLS on every table.
-- ---------------------------------------------------------------------------
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;

alter table public.schools enable row level security;
alter table public.sections enable row level security;
alter table public.years enable row level security;
alter table public.tracks enable row level security;
alter table public.classes enable row level security;
alter table public.academic_sessions enable row level security;
alter table public.terms enable row level security;
alter table public.subjects enable row level security;
alter table public.staff enable row level security;
alter table public.admin_sections enable row level security;
alter table public.staff_permissions enable row level security;
alter table public.teaching_assignments enable row level security;
alter table public.students enable row level security;
alter table public.questions enable row level security;
alter table public.assessments enable row level security;
alter table public.assessment_questions enable row level security;
alter table public.exam_windows enable row level security;
alter table public.exam_exceptions enable row level security;
alter table public.lab_terminals enable row level security;
alter table public.terminal_codes enable row level security;
alter table public.attempts enable row level security;
alter table public.attempt_answers enable row level security;
alter table public.attempt_events enable row level security;
alter table public.audit_log enable row level security;

-- ---------------------------------------------------------------------------
-- Structure: every staff member can read; only the super admin changes it.
-- ---------------------------------------------------------------------------
create policy schools_read on public.schools for select to authenticated using (id = public.my_school_id());
create policy schools_write on public.schools for update to authenticated using (public.is_super_admin() and id = public.my_school_id());

create policy sections_read on public.sections for select to authenticated using (school_id = public.my_school_id());
create policy sections_write on public.sections for all to authenticated
  using (public.is_super_admin() and school_id = public.my_school_id())
  with check (public.is_super_admin() and school_id = public.my_school_id());

create policy years_read on public.years for select to authenticated using (public.is_staff());
create policy years_write on public.years for all to authenticated
  using (public.is_super_admin()) with check (public.is_super_admin());

create policy tracks_read on public.tracks for select to authenticated using (school_id = public.my_school_id());
create policy tracks_write on public.tracks for all to authenticated
  using (public.is_super_admin()) with check (public.is_super_admin() and school_id = public.my_school_id());

create policy classes_read on public.classes for select to authenticated using (public.is_staff());
create policy classes_write on public.classes for all to authenticated
  using (public.admin_of_section((select section_id from public.years where id = year_id)))
  with check (public.admin_of_section((select section_id from public.years where id = year_id)));

create policy sessions_read on public.academic_sessions for select to authenticated using (school_id = public.my_school_id());
create policy sessions_write on public.academic_sessions for all to authenticated
  using (public.is_super_admin()) with check (public.is_super_admin() and school_id = public.my_school_id());

create policy terms_read on public.terms for select to authenticated using (public.is_staff());
create policy terms_write on public.terms for all to authenticated
  using (public.is_super_admin()) with check (public.is_super_admin());

create policy subjects_read on public.subjects for select to authenticated using (public.is_staff());
create policy subjects_write on public.subjects for all to authenticated
  using (public.admin_of_section(section_id)) with check (public.admin_of_section(section_id));

-- ---------------------------------------------------------------------------
-- Staff
-- ---------------------------------------------------------------------------
create policy staff_read on public.staff for select to authenticated using (school_id = public.my_school_id());
-- Creating staff needs an auth user, so it happens server-side with the service role.
create policy staff_update on public.staff for update to authenticated
  using (public.is_super_admin() and school_id = public.my_school_id())
  with check (public.is_super_admin() and school_id = public.my_school_id());

create policy admin_sections_read on public.admin_sections for select to authenticated using (public.is_staff());
create policy admin_sections_write on public.admin_sections for all to authenticated
  using (public.is_super_admin()) with check (public.is_super_admin());

create policy staff_permissions_read on public.staff_permissions for select to authenticated
  using (staff_id = auth.uid() or public.is_super_admin());
create policy staff_permissions_write on public.staff_permissions for all to authenticated
  using (public.is_super_admin()) with check (public.is_super_admin());

-- ---------------------------------------------------------------------------
-- Teaching assignments: teachers request, section admins approve.
-- ---------------------------------------------------------------------------
create policy assignments_read on public.teaching_assignments for select to authenticated
  using (teacher_id = auth.uid() or public.admin_of_section(public.section_of_class(class_id)));
create policy assignments_request on public.teaching_assignments for insert to authenticated
  with check (
    (teacher_id = auth.uid() and status = 'requested')
    or (public.admin_of_section(public.section_of_class(class_id)) and public.has_perm('teachers.manage'))
  );
create policy assignments_decide on public.teaching_assignments for update to authenticated
  using (public.admin_of_section(public.section_of_class(class_id)) and public.has_perm('teachers.manage'))
  with check (public.admin_of_section(public.section_of_class(class_id)) and public.has_perm('teachers.manage'));
create policy assignments_delete on public.teaching_assignments for delete to authenticated
  using (
    (teacher_id = auth.uid() and status = 'requested')
    or (public.admin_of_section(public.section_of_class(class_id)) and public.has_perm('teachers.manage'))
  );

-- ---------------------------------------------------------------------------
-- Students: section admins manage; teachers see students in classes they teach.
-- ---------------------------------------------------------------------------
create policy students_read on public.students for select to authenticated
  using (
    school_id = public.my_school_id() and (
      public.admin_of_section(public.section_of_class(class_id))
      or public.teaches_class(class_id)
      or public.is_super_admin()
    )
  );
create policy students_write on public.students for all to authenticated
  using (
    school_id = public.my_school_id() and public.has_perm('students.manage')
    and (class_id is null or public.admin_of_section(public.section_of_class(class_id)))
  )
  with check (
    school_id = public.my_school_id() and public.has_perm('students.manage')
    and (class_id is null or public.admin_of_section(public.section_of_class(class_id)))
  );

-- ---------------------------------------------------------------------------
-- Question bank: teachers of the subject share a bank; owners and admins edit.
-- ---------------------------------------------------------------------------
create policy questions_read on public.questions for select to authenticated
  using (
    owner_id = auth.uid()
    or public.teaches_subject(subject_id)
    or public.admin_of_section(public.section_of_subject(subject_id))
  );
create policy questions_insert on public.questions for insert to authenticated
  with check (
    owner_id = auth.uid()
    and (public.teaches_subject(subject_id) or public.admin_of_section(public.section_of_subject(subject_id)))
  );
create policy questions_update on public.questions for update to authenticated
  using (owner_id = auth.uid() or public.admin_of_section(public.section_of_subject(subject_id)))
  with check (owner_id = auth.uid() or public.admin_of_section(public.section_of_subject(subject_id)));
create policy questions_delete on public.questions for delete to authenticated
  using (owner_id = auth.uid() or public.admin_of_section(public.section_of_subject(subject_id)));

-- ---------------------------------------------------------------------------
-- Assessments: teacher drafts; status moves forward only through functions.
-- ---------------------------------------------------------------------------
-- Uses the row's own columns (not can_view_assessment(id)) so INSERT ... RETURNING can see the new row.
create policy assessments_read on public.assessments for select to authenticated
  using (
    created_by = auth.uid()
    or public.teaches_subject(subject_id)
    or public.admin_of_section(public.section_of_subject(subject_id))
  );
create policy assessments_insert on public.assessments for insert to authenticated
  with check (
    created_by = auth.uid() and status = 'draft' and paper is null
    and (public.teaches_subject(subject_id) or public.admin_of_section(public.section_of_subject(subject_id)))
  );
create policy assessments_update on public.assessments for update to authenticated
  using (public.can_edit_assessment(id))
  with check (status in ('draft', 'changes_requested') and paper is null);
create policy assessments_delete on public.assessments for delete to authenticated
  using (status = 'draft' and (created_by = auth.uid() or public.admin_of_section(public.section_of_subject(subject_id))));

create policy assessment_questions_read on public.assessment_questions for select to authenticated
  using (public.can_view_assessment(assessment_id));
create policy assessment_questions_write on public.assessment_questions for all to authenticated
  using (public.can_edit_assessment(assessment_id))
  with check (public.can_edit_assessment(assessment_id));

-- ---------------------------------------------------------------------------
-- Exam windows & exceptions: readable by those who can see the assessment; written by functions.
-- ---------------------------------------------------------------------------
create policy windows_read on public.exam_windows for select to authenticated
  using (public.can_view_assessment(assessment_id));

create policy exceptions_read on public.exam_exceptions for select to authenticated
  using (exists (select 1 from public.exam_windows w where w.id = window_id and public.can_view_assessment(w.assessment_id)));

-- ---------------------------------------------------------------------------
-- Terminals
-- ---------------------------------------------------------------------------
create policy terminals_read on public.lab_terminals for select to authenticated
  using (school_id = public.my_school_id());
create policy terminals_update on public.lab_terminals for update to authenticated
  using (school_id = public.my_school_id() and public.has_perm('terminals.manage'))
  with check (school_id = public.my_school_id() and public.has_perm('terminals.manage'));
-- terminal_codes: no policies → only the service role touches them.

-- ---------------------------------------------------------------------------
-- Attempts & answers: read-only for staff with visibility; written only by exam functions.
-- ---------------------------------------------------------------------------
create policy attempts_read on public.attempts for select to authenticated using (public.can_view_attempt(id));
create policy attempt_answers_read on public.attempt_answers for select to authenticated using (public.can_view_attempt(attempt_id));
create policy attempt_events_read on public.attempt_events for select to authenticated
  using (attempt_id is not null and public.can_view_attempt(attempt_id));

-- ---------------------------------------------------------------------------
-- Audit log: super admins read everything, admins read their own actions.
-- ---------------------------------------------------------------------------
create policy audit_read on public.audit_log for select to authenticated
  using (public.is_super_admin() or actor_id = auth.uid());
