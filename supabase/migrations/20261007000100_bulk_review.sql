-- Bulk approval: flags on approved tests, safe corrections after approval, and one function that reviews
-- many tests at once (each test succeeds or fails on its own).

alter table public.assessments
  add column flag_status text check (flag_status in ('open', 'resolved')),
  -- wrong_answers | duplicates | difficulty | typos | topic | other
  add column flag_category text,
  add column flag_note text,
  add column flagged_by uuid references public.staff (id) on delete set null,
  add column flagged_at timestamptz,
  add column flag_resolved_at timestamptz,
  -- true while the teacher corrects a flagged, approved test; the frozen paper stays in force until accepted
  add column amending boolean not null default false,
  add column corrections_submitted_at timestamptz;

create index on public.assessments (flag_status) where flag_status = 'open';

-- Editable while a draft, sent back, or being amended after approval.
create or replace function public.can_edit_assessment(aid uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.assessments a
    where a.id = aid
      and (a.status in ('draft', 'changes_requested') or (a.status = 'approved' and a.amending))
      and (a.created_by = auth.uid() or public.admin_of_section(public.section_of_subject(a.subject_id)))
  )
$$;

drop policy assessments_update on public.assessments;
create policy assessments_update on public.assessments for update to authenticated
  using (public.can_edit_assessment(id))
  with check ((status in ('draft', 'changes_requested') and paper is null) or (status = 'approved' and amending));

-- People can edit a test's own fields, but never the review state, flags or the frozen paper directly;
-- those only change through the functions below (which run with the owner's rights).
create or replace function public.protect_review_state()
returns trigger
language plpgsql
as $$
begin
  if current_user in ('authenticated', 'anon') then
    new.flag_status := old.flag_status;
    new.flag_category := old.flag_category;
    new.flag_note := old.flag_note;
    new.flagged_by := old.flagged_by;
    new.flagged_at := old.flagged_at;
    new.flag_resolved_at := old.flag_resolved_at;
    new.amending := old.amending;
    new.corrections_submitted_at := old.corrections_submitted_at;
    if old.status = 'approved' then
      new.status := old.status;
      new.paper := old.paper;
    end if;
  end if;
  return new;
end $$;

create trigger assessments_protect_review_state
  before update on public.assessments
  for each row execute function public.protect_review_state();

-- A frozen copy of the questions and answer key, as taken at approval.
create or replace function public._freeze_paper(p_assessment uuid)
returns jsonb
language sql stable
as $$
  select jsonb_build_object(
           'questions', jsonb_agg(jsonb_build_object(
               'id', q.id, 'body', q.body, 'options', q.options, 'answer', q.answer,
               'image_url', q.image_url, 'topic', q.topic, 'explanation', q.explanation
             ) order by aq.position, q.created_at),
           'frozen_at', now())
  from public.assessment_questions aq
  join public.questions q on q.id = aq.question_id
  where aq.assessment_id = p_assessment
$$;

-- Review many tests in one go. Items: [{ "id", "action": "approve" | "flag" | "send_back", "category", "note" }].
-- Returns [{ "id", "ok", "error" }]; one test failing never stops the others.
create or replace function public.bulk_review(p_items jsonb)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  item jsonb;
  aid uuid;
  act text;
  cat text;
  note text;
  results jsonb := '[]'::jsonb;
begin
  for item in select * from jsonb_array_elements(p_items) loop
    aid := (item->>'id')::uuid;
    act := item->>'action';
    cat := nullif(trim(coalesce(item->>'category', '')), '');
    note := nullif(trim(coalesce(item->>'note', '')), '');
    begin
      if act = 'send_back' then
        perform public._require(note is not null, 'say what needs to change');
        perform public.review_assessment(aid, false, note);
      elsif act in ('approve', 'flag') then
        if act = 'flag' then
          perform public._require(cat in ('wrong_answers', 'duplicates', 'difficulty', 'typos', 'topic', 'other'), 'choose a reason for the flag');
        end if;
        perform public._require(
          not exists (
            select 1
            from public.assessment_questions aq
            join public.questions q on q.id = aq.question_id
            where aq.assessment_id = aid
              and (jsonb_array_length(q.options) < 2
                   or not exists (select 1 from jsonb_array_elements(q.options) o where o->>'key' = q.answer))
          ),
          'a question has no valid correct answer');
        perform public.review_assessment(aid, true, null);
        if act = 'flag' then
          update public.assessments
             set flag_status = 'open', flag_category = cat, flag_note = note,
                 flagged_by = auth.uid(), flagged_at = now(), flag_resolved_at = null
           where id = aid;
          -- A flagged test is never started automatically: an administrator presses Start on the day.
          update public.exam_windows set auto_start = false where assessment_id = aid;
          perform public.log_audit('assessment.flag', 'assessment', aid::text, jsonb_build_object('category', cat, 'note', note));
        end if;
      else
        raise exception 'unknown action';
      end if;
      results := results || jsonb_build_object('id', aid, 'ok', true);
    exception when others then
      results := results || jsonb_build_object('id', aid, 'ok', false, 'error', sqlerrm);
    end;
  end loop;
  return results;
end $$;
grant execute on function public.bulk_review(jsonb) to authenticated;

-- Teacher (or admin) starts correcting a flagged, approved test. Allowed until a student has started it.
create or replace function public.begin_amendment(p_assessment uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  a public.assessments;
begin
  select * into a from public.assessments where id = p_assessment for update;
  perform public._require(found, 'assessment not found');
  perform public._require(
    a.created_by = auth.uid() or public.admin_of_section(public.section_of_subject(a.subject_id)), 'not allowed');
  perform public._require(a.status = 'approved' and a.flag_status = 'open', 'only a flagged, approved test can be corrected');
  perform public._require(not exists (select 1 from public.attempts where assessment_id = a.id),
    'students have already started this test, so its questions can no longer be changed');
  update public.assessments set amending = true, corrections_submitted_at = null where id = a.id;
  perform public.log_audit('assessment.amend_begin', 'assessment', a.id::text, null);
end $$;
grant execute on function public.begin_amendment(uuid) to authenticated;

-- Teacher says the corrections are done; the Head of Section then accepts them.
create or replace function public.submit_amendment(p_assessment uuid)
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
    a.created_by = auth.uid() or public.admin_of_section(public.section_of_subject(a.subject_id)), 'not allowed');
  perform public._require(a.amending, 'this test is not being corrected');
  select count(*) into pool from public.assessment_questions where assessment_id = a.id;
  perform public._require(pool >= a.question_count,
    format('this test needs at least %s questions; it has %s', a.question_count, pool));
  update public.assessments set corrections_submitted_at = now() where id = a.id;
  perform public.log_audit('assessment.amend_submit', 'assessment', a.id::text, null);
end $$;
grant execute on function public.submit_amendment(uuid) to authenticated;

-- Head of Section accepts the corrections: the new questions are frozen, the flag is resolved.
create or replace function public.accept_amendment(p_assessment uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  a public.assessments;
begin
  select * into a from public.assessments where id = p_assessment for update;
  perform public._require(found, 'assessment not found');
  perform public._require(
    public.admin_of_section(public.section_of_subject(a.subject_id)) and public.has_perm('exam.approve'),
    'you do not have permission to approve assessments in this section');
  perform public._require(a.amending, 'this test is not being corrected');
  perform public._require(not exists (select 1 from public.attempts where assessment_id = a.id),
    'students have already started this test, so the corrected version cannot replace it; use Fix answer key in Reports');
  update public.assessments
     set paper = public._freeze_paper(a.id), amending = false, corrections_submitted_at = null,
         flag_status = 'resolved', flag_resolved_at = now(), reviewed_by = auth.uid(), reviewed_at = now()
   where id = a.id;
  perform public.log_audit('assessment.amend_accept', 'assessment', a.id::text, null);
end $$;
grant execute on function public.accept_amendment(uuid) to authenticated;

-- Stop correcting: the approved (frozen) version stays exactly as it was.
create or replace function public.cancel_amendment(p_assessment uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  a public.assessments;
begin
  select * into a from public.assessments where id = p_assessment for update;
  perform public._require(found, 'assessment not found');
  perform public._require(
    a.created_by = auth.uid() or public.admin_of_section(public.section_of_subject(a.subject_id)), 'not allowed');
  update public.assessments set amending = false, corrections_submitted_at = null where id = a.id;
end $$;
grant execute on function public.cancel_amendment(uuid) to authenticated;

-- Head of Section closes a flag without any change to the test.
create or replace function public.resolve_flag(p_assessment uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  a public.assessments;
begin
  select * into a from public.assessments where id = p_assessment for update;
  perform public._require(found, 'assessment not found');
  perform public._require(
    public.admin_of_section(public.section_of_subject(a.subject_id)) and public.has_perm('exam.approve'),
    'you do not have permission to approve assessments in this section');
  perform public._require(a.flag_status = 'open', 'there is no open flag on this test');
  update public.assessments
     set flag_status = 'resolved', flag_resolved_at = now(), amending = false, corrections_submitted_at = null
   where id = a.id;
  perform public.log_audit('assessment.flag_resolve', 'assessment', a.id::text, null);
end $$;
grant execute on function public.resolve_flag(uuid) to authenticated;

-- Same as before, except a test with an open flag can't be set to start by itself.
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
  auto boolean;
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
  auto := p_auto_start and coalesce(a.flag_status, '') <> 'open';

  select * into w from public.exam_windows where assessment_id = a.id and class_id = p_class;
  if found then
    perform public._require(public.window_state(w) in ('scheduled', 'awaiting_start'),
      'this exam has already started; use Extend time instead of rescheduling');
    update public.exam_windows
       set starts_at = p_starts, ends_at = p_ends, auto_start = auto
     where id = w.id;
    wid := w.id;
  else
    insert into public.exam_windows (assessment_id, class_id, starts_at, ends_at, auto_start, created_by)
    values (a.id, p_class, p_starts, p_ends, auto, auth.uid())
    returning id into wid;
  end if;
  perform public.log_audit('window.schedule', 'exam_window', wid::text,
    jsonb_build_object('class_id', p_class, 'starts_at', p_starts, 'ends_at', p_ends, 'auto_start', auto));
  return wid;
end $$;
