-- Question uploads: every file or paste a teacher imports becomes a named set ("1st CA — Year 9 Maths"),
-- so the bank can be browsed and used per upload, and so there is a record of what was in the file,
-- what was saved and why anything was left out.
--
-- ADDITIVE ONLY: one new table, one new nullable column, one new function. No existing row is changed;
-- questions already in the bank simply have no upload (shown as "Added before uploads were tracked").

create table public.question_uploads (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.staff (id) on delete cascade,
  subject_id uuid not null references public.subjects (id) on delete cascade,
  year_id uuid references public.years (id) on delete set null,
  -- the test it was uploaded into, if any
  assessment_id uuid references public.assessments (id) on delete set null,
  label text not null check (length(trim(label)) between 1 and 80),
  file_name text check (file_name is null or length(file_name) <= 200),
  source_format text check (source_format is null or source_format in ('paste', 'word', 'excel', 'csv', 'json', 'text')),
  -- The receipt. found = imported + linked + duplicates + removed + unreadable.
  found_count int not null default 0 check (found_count >= 0),
  imported_count int not null default 0 check (imported_count >= 0),
  linked_count int not null default 0 check (linked_count >= 0),
  duplicate_count int not null default 0 check (duplicate_count >= 0),
  removed_count int not null default 0 check (removed_count >= 0),
  unreadable_count int not null default 0 check (unreadable_count >= 0),
  -- [{ "code", "source", "message", "excerpt" }] — why each left-out question was left out
  issues jsonb not null default '[]'::jsonb check (jsonb_typeof(issues) = 'array'),
  created_at timestamptz not null default now()
);
create index question_uploads_owner_idx on public.question_uploads (owner_id, subject_id, created_at desc);
create index question_uploads_subject_idx on public.question_uploads (subject_id, year_id);

alter table public.questions add column upload_id uuid references public.question_uploads (id) on delete set null;
create index questions_upload_idx on public.questions (upload_id) where upload_id is not null;

alter table public.question_uploads enable row level security;

-- Same visibility as the questions themselves: the owner, teachers of the subject, and the section's admins.
create policy question_uploads_read on public.question_uploads for select to authenticated
  using (
    owner_id = auth.uid()
    or public.teaches_subject(subject_id)
    or public.admin_of_section(public.section_of_subject(subject_id))
  );
-- Same rule as adding questions: teachers may upload while their subject is still awaiting approval.
create policy question_uploads_insert on public.question_uploads for insert to authenticated
  with check (
    owner_id = auth.uid()
    and (public.requested_or_teaches_subject(subject_id) or public.admin_of_section(public.section_of_subject(subject_id)))
  );
create policy question_uploads_update on public.question_uploads for update to authenticated
  using (owner_id = auth.uid() or public.admin_of_section(public.section_of_subject(subject_id)))
  with check (owner_id = auth.uid() or public.admin_of_section(public.section_of_subject(subject_id)));
create policy question_uploads_delete on public.question_uploads for delete to authenticated
  using (owner_id = auth.uid() or public.admin_of_section(public.section_of_subject(subject_id)));

grant select, insert, update, delete on public.question_uploads to authenticated;

-- Saves an upload in ONE transaction: the upload record, the new questions, and (when uploading into a
-- test) the links to that test — including questions that were already in the bank. Either everything
-- is saved or nothing is, so a failure can never leave questions in the bank but missing from the test.
--
-- Runs with the caller's rights (security invoker), so the normal row-level security rules apply.
--
-- p_upload:    { subject_id, year_id, assessment_id, label, file_name, source_format,
--                found_count, duplicate_count, removed_count, unreadable_count, issues }
-- p_questions: [{ body, options, answer, topic, difficulty, explanation, image_url }] in file order
-- p_link_existing: ids of questions already in the bank to add to the test (duplicates of this upload)
create or replace function public.import_questions(p_upload jsonb, p_questions jsonb, p_link_existing uuid[] default '{}')
returns jsonb
language plpgsql security invoker set search_path = public
as $$
declare
  v_subject uuid := (p_upload->>'subject_id')::uuid;
  v_year uuid := nullif(p_upload->>'year_id', '')::uuid;
  v_assessment uuid := nullif(p_upload->>'assessment_id', '')::uuid;
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
    owner_id, subject_id, year_id, assessment_id, label, file_name, source_format,
    found_count, duplicate_count, removed_count, unreadable_count, issues)
  values (
    auth.uid(), v_subject, v_year, v_assessment,
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
    insert into public.questions (subject_id, year_id, owner_id, upload_id, body, options, answer, topic, difficulty, explanation, image_url)
    values (
      v_subject, v_year, auth.uid(), v_upload,
      q->>'body', q->'options', q->>'answer',
      nullif(q->>'topic', ''), nullif(q->>'difficulty', '')::smallint,
      nullif(q->>'explanation', ''), nullif(q->>'image_url', ''))
    returning id into v_qid;
    v_ids := v_ids || v_qid;
  end loop;

  if v_assessment is not null then
    select coalesce(max(position), 0) into v_pos from public.assessment_questions where assessment_id = v_assessment;
    -- new questions first, in file order; then the ones that were already in the bank
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
