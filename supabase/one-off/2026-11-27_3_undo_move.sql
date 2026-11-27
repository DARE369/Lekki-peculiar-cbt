-- ============================================================================================================
-- UNDO: put every record the move relabelled back under Second Term. Only needed if the move was a mistake.
-- Uses term_move_log, so it moves back exactly what was moved. A record that has been moved again since stays
-- where it is; an exam calendar date that would now clash is left and counted. Edit times are left as they are.
-- ============================================================================================================
create or replace function pg_temp.undo_term_move(p_batch text default null) returns jsonb language plpgsql as $fn$
declare
  v_batch text;
  n jsonb := '{}'::jsonb;
  c int;
begin
  v_batch := coalesce(p_batch, (select batch from public.term_move_log where undone_at is null order by moved_at desc limit 1));
  if v_batch is null then raise exception 'There is nothing to undo.'; end if;

  lock table public.assessments, public.questions, public.question_uploads, public.round_schedules in share row exclusive mode;
  alter table public.assessments disable trigger assessments_touch;
  alter table public.questions disable trigger questions_touch;

  with back as (
    update public.assessments t set term_id = l.old_term_id from public.term_move_log l
     where l.batch = v_batch and l.table_name = 'assessments' and l.undone_at is null and l.row_id = t.id and t.term_id = l.new_term_id
    returning l.id)
  update public.term_move_log set undone_at = now() where id in (select id from back);
  get diagnostics c = row_count; n := n || jsonb_build_object('tests_restored', c);

  with back as (
    update public.questions t set term_id = l.old_term_id from public.term_move_log l
     where l.batch = v_batch and l.table_name = 'questions' and l.undone_at is null and l.row_id = t.id and t.term_id = l.new_term_id
    returning l.id)
  update public.term_move_log set undone_at = now() where id in (select id from back);
  get diagnostics c = row_count; n := n || jsonb_build_object('questions_restored', c);

  with back as (
    update public.question_uploads t set term_id = l.old_term_id from public.term_move_log l
     where l.batch = v_batch and l.table_name = 'question_uploads' and l.undone_at is null and l.row_id = t.id and t.term_id = l.new_term_id
    returning l.id)
  update public.term_move_log set undone_at = now() where id in (select id from back);
  get diagnostics c = row_count; n := n || jsonb_build_object('question_banks_restored', c);

  with back as (
    update public.round_schedules t set term_id = l.old_term_id from public.term_move_log l
     where l.batch = v_batch and l.table_name = 'round_schedules' and l.undone_at is null and l.row_id = t.id and t.term_id = l.new_term_id
       and not exists (select 1 from public.round_schedules o where o.term_id = l.old_term_id and o.round_id = t.round_id and o.year_id = t.year_id)
    returning l.id)
  update public.term_move_log set undone_at = now() where id in (select id from back);
  get diagnostics c = row_count; n := n || jsonb_build_object('exam_calendar_dates_restored', c);

  alter table public.assessments enable trigger assessments_touch;
  alter table public.questions enable trigger questions_touch;

  n := n || jsonb_build_object('batch', v_batch,
    'not_restored_because_changed_since', (select count(*) from public.term_move_log where batch = v_batch and undone_at is null));
  insert into public.audit_log (actor_id, action, entity, entity_id, detail) values (null, 'term.records_move_undone', 'term', null, n);
  return n;
end $fn$;

select jsonb_pretty(pg_temp.undo_term_move(null)) as result;
