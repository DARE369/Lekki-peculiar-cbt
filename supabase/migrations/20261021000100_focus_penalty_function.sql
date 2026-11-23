-- Setting the focus-leave penalty on exams (one or many) was done by writing to exam_windows directly, but staff
-- have no permission to write to that table, so the change was silently ignored while the screen said "saved".
-- This function does it properly: it checks the person may manage exams for each class, and records the change.
--
-- ADDITIVE ONLY: one new function. No existing row is changed.
create or replace function public.set_focus_penalty(p_windows uuid[], p_minutes int)
returns int
language plpgsql security definer set search_path = public
as $$
declare
  wid uuid;
  w public.exam_windows;
  n int := 0;
begin
  perform public._require(p_minutes between 0 and 60, 'choose between 0 and 60 minutes');
  perform public._require(coalesce(array_length(p_windows, 1), 0) between 1 and 100, 'choose between 1 and 100 exams');
  foreach wid in array p_windows loop
    select * into w from public.exam_windows where id = wid for update;
    if not found then continue; end if;
    perform public._require(
      public.admin_of_section(public.section_of_class(w.class_id)) and public.has_perm('exam.start'),
      'you do not have permission to change this exam');
    update public.exam_windows set focus_penalty_minutes = p_minutes where id = wid;
    perform public.log_audit('window.focus_penalty', 'exam_window', wid::text, jsonb_build_object('minutes', p_minutes));
    n := n + 1;
  end loop;
  return n;
end $$;
grant execute on function public.set_focus_penalty(uuid[], int) to authenticated;
