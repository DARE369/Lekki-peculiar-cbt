-- One-click "hide results from students": works on any test, even after approval, and is remembered so
-- turning it back on restores whatever the teacher had chosen (score, or score and corrections).
--
-- ADDITIVE ONLY: one new function. It edits the settings of the one test named, nothing else.
create or replace function public.set_results_hidden(p_assessment uuid, p_hidden boolean)
returns text
language plpgsql security definer set search_path = public
as $$
declare
  a public.assessments;
  cur text;
  restored text;
begin
  select * into a from public.assessments where id = p_assessment for update;
  perform public._require(found, 'test not found');
  perform public._require(
    public.admin_of_section(public.section_of_subject(a.subject_id)) and (public.has_perm('exam.start') or public.has_perm('exam.approve')),
    'permission denied');

  cur := coalesce(a.settings ->> 'show_result', 'score');
  if p_hidden then
    if cur <> 'none' then
      update public.assessments
         set settings = jsonb_set(coalesce(settings, '{}'::jsonb) || jsonb_build_object('show_result_before', cur), '{show_result}', '"none"')
       where id = p_assessment;
    end if;
    restored := 'none';
  else
    restored := case when coalesce(a.settings ->> 'show_result_before', 'score') in ('score', 'full')
                     then coalesce(a.settings ->> 'show_result_before', 'score') else 'score' end;
    if cur = 'none' then
      update public.assessments
         set settings = jsonb_set(coalesce(settings, '{}'::jsonb), '{show_result}', to_jsonb(restored)) - 'show_result_before'
       where id = p_assessment;
    end if;
  end if;

  perform public.log_audit(case when p_hidden then 'results.hidden' else 'results.shown' end, 'assessment', p_assessment::text,
    jsonb_build_object('show_result', restored));
  return restored;
end $$;
grant execute on function public.set_results_hidden(uuid, boolean) to authenticated;
