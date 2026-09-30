-- Student identification at the lab terminal + default school structure.

-- Exact match on the normalised admission number, otherwise close matches (typos).
create or replace function public.exam_lookup_admission(p_school uuid, p_input text)
returns table (student_id uuid, exact boolean)
language plpgsql stable security definer set search_path = public, extensions
as $$
declare
  k text := public.normalize_admission(p_input);
begin
  if length(k) < 2 then return; end if;
  return query
    select s.id, true from public.students s
     where s.school_id = p_school and s.active and s.admission_key = k;
  if found then return; end if;
  return query
    select s.id, false from public.students s
     where s.school_id = p_school and s.active
       and (similarity(s.admission_key, k) > 0.45 or levenshtein_less_equal(s.admission_key, k, 2) <= 2)
     order by similarity(s.admission_key, k) desc
     limit 3;
end $$;

-- "I don't know my number": fuzzy name search inside one class.
create or replace function public.exam_search_names(p_class uuid, p_query text)
returns table (student_id uuid)
language sql stable security definer set search_path = public, extensions
as $$
  select s.id
  from public.students s
  where s.class_id = p_class and s.active
    and (
      length(trim(coalesce(p_query, ''))) = 0
      or s.search_name like '%' || lower(trim(p_query)) || '%'
      or word_similarity(lower(trim(p_query)), s.search_name) > 0.35
    )
  order by
    (s.search_name like lower(trim(p_query)) || '%') desc,
    word_similarity(lower(trim(coalesce(p_query, ''))), s.search_name) desc,
    s.first_name, s.last_name
  limit 40
$$;

revoke execute on function public.exam_lookup_admission(uuid, text) from public, anon, authenticated;
revoke execute on function public.exam_search_names(uuid, text) from public, anon, authenticated;
grant execute on function public.exam_lookup_admission(uuid, text) to service_role;
grant execute on function public.exam_search_names(uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- Default structure for Lekki Peculiar (safe to edit from the admin console afterwards)
-- ---------------------------------------------------------------------------
do $$
declare
  sch uuid;
  pre uuid;
  elem uuid;
  coll uuid;
  sess uuid;
  i int;
begin
  if exists (select 1 from public.schools) then return; end if;

  insert into public.schools (name, short_name) values ('Lekki Peculiar School', 'LPS') returning id into sch;

  insert into public.sections (school_id, code, name, cbt_enabled, sort)
  values (sch, 'PRE', 'Pre-School', false, 0) returning id into pre;
  insert into public.sections (school_id, code, name, cbt_enabled, sort)
  values (sch, 'ELEM', 'Elementary', true, 1) returning id into elem;
  insert into public.sections (school_id, code, name, cbt_enabled, sort)
  values (sch, 'COLL', 'College', true, 2) returning id into coll;

  for i in 1..6 loop
    insert into public.years (section_id, name, level) values (elem, 'Year ' || i, i);
  end loop;
  for i in 7..12 loop
    insert into public.years (section_id, name, level, stage)
    values (coll, 'Year ' || i, i, case when i <= 9 then 'junior' else 'senior' end);
  end loop;

  insert into public.tracks (school_id, name) values (sch, 'Science'), (sch, 'Art'), (sch, 'Commerce');

  insert into public.academic_sessions (school_id, name, is_current) values (sch, '2026/2027', true) returning id into sess;
  insert into public.terms (session_id, name, ordinal, is_current) values
    (sess, 'First Term', 1, true), (sess, 'Second Term', 2, false), (sess, 'Third Term', 3, false);

  insert into public.subjects (section_id, name) select elem, n from unnest(array[
    'English Language', 'Mathematics', 'Basic Science', 'Social Studies', 'French', 'Verbal Reasoning',
    'Quantitative Reasoning', 'Computer Studies', 'Christian Religious Studies', 'Civic Education'
  ]) n;
  insert into public.subjects (section_id, name) select coll, n from unnest(array[
    'English Language', 'Mathematics', 'Further Mathematics', 'Biology', 'Chemistry', 'Physics',
    'Basic Science', 'Basic Technology', 'Agricultural Science', 'Geography', 'Economics', 'Commerce',
    'Financial Accounting', 'Business Studies', 'Government', 'Literature in English',
    'Christian Religious Studies', 'Civic Education', 'History', 'French', 'Computer Studies'
  ]) n;
end $$;

-- ---------------------------------------------------------------------------
-- Private storage for student photos (served to staff and terminals via signed URLs).
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'storage' and table_name = 'buckets') then
    insert into storage.buckets (id, name, public)
    values ('student-photos', 'student-photos', false)
    on conflict (id) do nothing;
    insert into storage.buckets (id, name, public)
    values ('question-images', 'question-images', true)
    on conflict (id) do nothing;
  end if;
end $$;
