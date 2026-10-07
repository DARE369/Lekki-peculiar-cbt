-- Focus-leave penalty
-- Per exam window: when > 0, students who leave the exam screen face a
-- countdown overlay before they can continue. The time counts against them
-- (their deadline does not move).

alter table public.exam_windows
  add column focus_penalty_minutes int not null default 0
    check (focus_penalty_minutes >= 0 and focus_penalty_minutes <= 60);

-- Update _exam_payload to include focus_penalty_minutes so the terminal can
-- enforce the rule client-side without a round trip.
create or replace function public._exam_payload(p_attempt uuid)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  t public.attempts;
  a public.assessments;
  w public.exam_windows;
  subj text;
  qs jsonb;
  ans jsonb;
begin
  select * into t from public.attempts where id = p_attempt;
  select * into a from public.assessments where id = t.assessment_id;
  select * into w from public.exam_windows where id = t.window_id;
  select name into subj from public.subjects where id = a.subject_id;

  select jsonb_agg(jsonb_build_object(
           'id', q ->> 'id',
           'body', q ->> 'body',
           'image_url', q ->> 'image_url',
           'options', (
             select jsonb_agg(jsonb_build_object(
                      'key', k,
                      'text', (select o ->> 'text' from jsonb_array_elements(q -> 'options') o where o ->> 'key' = k))
                    order by ki)
             from jsonb_array_elements_text(x.ord -> 'o') with ordinality y(k, ki))
         ) order by x.oi)
    into qs
  from jsonb_array_elements(t.question_order) with ordinality x(ord, oi)
  join lateral (
    select e as q from jsonb_array_elements(a.paper -> 'questions') e where e ->> 'id' = x.ord ->> 'q'
  ) qq on true;

  select coalesce(jsonb_agg(jsonb_build_object(
           'q', question_id, 's', selected, 'f', flagged, 'at', answered_at)), '[]'::jsonb)
    into ans
  from public.attempt_answers where attempt_id = t.id;

  return jsonb_build_object(
    'attempt', jsonb_build_object(
      'id', t.id, 'status', t.status, 'started_at', t.started_at, 'deadline', t.deadline,
      'window_id', t.window_id, 'is_makeup', t.is_makeup),
    'assessment', jsonb_build_object(
      'id', a.id, 'title', a.title, 'type', a.type, 'subject', subj,
      'duration_minutes', a.duration_minutes, 'question_count', jsonb_array_length(t.question_order),
      'settings', a.settings - 'pass_mark',
      'focus_penalty_minutes', coalesce(w.focus_penalty_minutes, 0)),
    'questions', qs,
    'answers', ans,
    'server_now', now());
end $$;
