-- Error log: every unexpected failure in a staff action is recorded with a short reference code.
-- Staff see "Something went wrong (Ref K7Q2M)"; admins look the code up on the Problems page.
--
-- ADDITIVE ONLY: one new table. Written by the server (service role) only, so nobody can fill it from
-- the browser; readable by super admins, and by Heads of Section for their own sections' staff.

create table public.app_errors (
  id bigint generated always as identity primary key,
  ref text not null unique check (ref ~ '^[A-Z0-9]{5,8}$'),
  staff_id uuid references public.staff (id) on delete set null,
  -- what the person was doing, e.g. "questions.import", "assessment.submit"
  area text not null check (length(area) between 1 and 80),
  -- the friendly message they were shown
  shown text,
  -- the underlying error (database message, code, details)
  message text not null,
  code text,
  detail jsonb,
  created_at timestamptz not null default now()
);
create index app_errors_created_idx on public.app_errors (created_at desc);
create index app_errors_staff_idx on public.app_errors (staff_id, created_at desc);

alter table public.app_errors enable row level security;

create policy app_errors_read on public.app_errors for select to authenticated
  using (
    public.is_super_admin()
    or (
      public.my_staff_role() = 'admin'
      and exists (
        select 1 from public.staff s
        join public.admin_sections a on a.section_id = s.home_section_id and a.staff_id = auth.uid()
        where s.id = app_errors.staff_id
      )
    )
    or staff_id = auth.uid()
  );
-- No insert/update/delete policies: only the server's service role writes here.
grant select on public.app_errors to authenticated;
