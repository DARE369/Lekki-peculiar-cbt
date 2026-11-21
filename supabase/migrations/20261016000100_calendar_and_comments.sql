-- Exam calendar: when each round runs for each year group this term. Approving a test then dates it
-- automatically from here, instead of being scheduled class by class afterwards.
-- Review comments: the Head of Section can comment on a specific question ("Q12: the answer is C").
--
-- ADDITIVE ONLY: two new tables. No existing row is changed.

create table public.round_schedules (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references public.ca_round_configs (id) on delete cascade,
  term_id uuid not null references public.terms (id) on delete cascade,
  year_id uuid not null references public.years (id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  created_by uuid references public.staff (id) on delete set null,
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at),
  unique (round_id, term_id, year_id)
);

alter table public.round_schedules enable row level security;

-- Every staff member can see the calendar; the section's admins with exam.approve set it.
create policy round_schedules_read on public.round_schedules for select to authenticated using (public.is_staff());
create policy round_schedules_write on public.round_schedules for all to authenticated
  using (
    public.has_perm('exam.approve')
    and public.admin_of_section((select y.section_id from public.years y where y.id = year_id))
  )
  with check (
    public.has_perm('exam.approve')
    and public.admin_of_section((select y.section_id from public.years y where y.id = year_id))
  );
grant select, insert, update, delete on public.round_schedules to authenticated;

create table public.review_comments (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid not null references public.assessments (id) on delete cascade,
  question_id uuid references public.questions (id) on delete set null,
  body text not null check (length(trim(body)) between 1 and 1000),
  author_id uuid references public.staff (id) on delete set null,
  created_at timestamptz not null default now(),
  -- set when the teacher marks it fixed (or the reviewer removes it)
  resolved_at timestamptz
);
create index review_comments_assessment_idx on public.review_comments (assessment_id) where resolved_at is null;

alter table public.review_comments enable row level security;

-- Seen by anyone who can see the test; written by the section's reviewers; resolved by the teacher or reviewer.
create policy review_comments_read on public.review_comments for select to authenticated
  using (public.can_view_assessment(assessment_id));
create policy review_comments_insert on public.review_comments for insert to authenticated
  with check (
    author_id = auth.uid()
    and public.has_perm('exam.approve')
    and exists (select 1 from public.assessments a where a.id = assessment_id
                and public.admin_of_section(public.section_of_subject(a.subject_id)))
  );
create policy review_comments_update on public.review_comments for update to authenticated
  using (
    author_id = auth.uid()
    or exists (select 1 from public.assessments a where a.id = assessment_id
               and (a.created_by = auth.uid() or public.admin_of_section(public.section_of_subject(a.subject_id))))
  );
create policy review_comments_delete on public.review_comments for delete to authenticated
  using (author_id = auth.uid());
-- Only resolved_at can be changed after writing: a teacher marks a comment fixed but cannot reword it.
grant select, insert, delete on public.review_comments to authenticated;
grant update (resolved_at) on public.review_comments to authenticated;
