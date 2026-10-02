-- Every teacher belongs to one section (Elementary or College). Heads of Section see only the staff of
-- their own section(s); the super admin sees everyone.
alter table public.staff add column home_section_id uuid references public.sections (id) on delete set null;

-- Work out the section for teachers who already have subject choices.
update public.staff st set home_section_id = x.section_id
from (
  select distinct on (ta.teacher_id) ta.teacher_id, sub.section_id
  from public.teaching_assignments ta
  join public.subjects sub on sub.id = ta.subject_id
  group by ta.teacher_id, sub.section_id
  order by ta.teacher_id, count(*) desc
) x
where st.id = x.teacher_id and st.role = 'teacher';

-- Heads of Section don't need a home section: the sections they manage (admin_sections) are used instead.

-- True when the signed-in person and the given staff member share a section
-- (a section they head or belong to).
create or replace function public.shares_section_with(p_staff uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  with mine as (
    select section_id from public.admin_sections where staff_id = auth.uid()
    union
    select home_section_id from public.staff where id = auth.uid() and home_section_id is not null
  ), theirs as (
    select section_id from public.admin_sections where staff_id = p_staff
    union
    select home_section_id from public.staff where id = p_staff and home_section_id is not null
  )
  select exists (select 1 from mine join theirs using (section_id))
$$;
grant execute on function public.shares_section_with(uuid) to authenticated;

-- Who may read a staff record: yourself, the super admins' names, the people in your section(s),
-- and everyone for the super admin.
drop policy staff_read on public.staff;
create policy staff_read on public.staff for select to authenticated
  using (
    school_id = public.my_school_id()
    and (public.is_super_admin() or id = auth.uid() or role = 'super_admin' or public.shares_section_with(id))
  );
