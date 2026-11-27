-- ============================================================================================================
-- ONE-OFF DATA FIX: move everything filed under Second Term to First Term (same academic session).
--
-- What it changes: ONLY the term each record is filed under. Nothing else about any record is touched.
--   moved:      tests (assessments), questions, question banks (uploads), exam calendar dates
--   follows on  results, scores, answers, exam windows, make-ups, comments: they have no term of their own,
--   its own:    they belong to a test, so they appear under First Term automatically.
--
-- Built to be safe:
--   * Run 2026-11-27_1_preview.sql first and read it.
--   * All or nothing: if any check fails, nothing is changed.
--   * It proves nothing else changed: every moved row is fingerprinted (ignoring only its term) before and after,
--     and the script aborts and rolls back if even one value differs. That includes the "last edited" times,
--     which the database would normally rewrite on any update (it pauses that for the move).
--   * Only the CURRENT session's Second Term is touched. Earlier years' Second Terms are never moved.
--   * It will not run twice. Every moved row is recorded in term_move_log, so it can be undone with
--     2026-11-27_3_undo_move.sql.
--   * Exam calendar dates that would clash with one already in First Term are left where they are and counted.
--
-- Run it once, in the Supabase SQL editor (as the database owner). It is NOT in supabase/migrations on purpose:
-- a migration runs on every new or restored database, where it could move real Second Term data.
-- ============================================================================================================

-- A record of exactly what was moved, so it can be undone. Nobody can read it through the app.
create table if not exists public.term_move_log (
  id bigint generated always as identity primary key,
  batch text not null,
  table_name text not null check (table_name in ('assessments', 'questions', 'question_uploads', 'round_schedules')),
  row_id uuid not null,
  old_term_id uuid not null,
  new_term_id uuid not null,
  moved_at timestamptz not null default now(),
  undone_at timestamptz
);
create index if not exists term_move_log_batch_idx on public.term_move_log (batch, table_name);
alter table public.term_move_log enable row level security;
revoke all on public.term_move_log from anon, authenticated;

-- A fingerprint of a table's rows, ignoring only the term. Equal before and after means nothing else changed.
create or replace function pg_temp.fingerprint(t regclass) returns text language plpgsql as $fn$
declare r text;
begin
  execute format(
    'select md5(coalesce(string_agg(h, '','' order by h), '''')) from (select md5((to_jsonb(x) - ''term_id'')::text) as h from %s x) s', t)
  into r;
  return r;
end $fn$;

create or replace function pg_temp.move_second_term_to_first(p_session_name text default null) returns jsonb language plpgsql as $fn$
declare
  v_session uuid; v_session_name text;
  v_first uuid; v_first_name text; v_second uuid; v_second_name text;
  v_batch text;
  b_assess int; b_q int; b_up int; b_cal int;                       -- how many there are to move
  c_assess int; c_q int; c_up int; c_cal int; c_cal_left int;       -- how many were moved
  n_attempts int; n_windows int;
  fp_before jsonb; fp_after jsonb;
  summary jsonb;
begin
  -- 1. Which session and terms. Default: the current session.
  if p_session_name is null then
    if (select count(*) from public.academic_sessions where is_current) <> 1 then
      raise exception 'Expected exactly one current session. Pass the session name explicitly, e.g. ''2026/2027''.';
    end if;
    select id, name into v_session, v_session_name from public.academic_sessions where is_current;
  else
    select id, name into v_session, v_session_name from public.academic_sessions where name = p_session_name;
    if v_session is null then raise exception 'No session called %', p_session_name; end if;
  end if;
  select id, name into v_first, v_first_name from public.terms where session_id = v_session and ordinal = 1;
  select id, name into v_second, v_second_name from public.terms where session_id = v_session and ordinal = 2;
  if v_first is null or v_second is null then raise exception 'That session does not have both a first and a second term.'; end if;
  if v_first_name !~* 'first' or v_second_name !~* 'second' then
    raise exception 'The terms are called "%" and "%", not First and Second Term. Nothing was changed.', v_first_name, v_second_name;
  end if;

  -- 2. Never twice.
  if exists (select 1 from public.term_move_log where batch like 'second-to-first:' || v_session || ':%' and undone_at is null) then
    raise exception 'This move has already been done for %. Nothing was changed. (Use the undo script if it must be reversed.)', v_session_name;
  end if;
  v_batch := 'second-to-first:' || v_session || ':' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISS');

  -- 3. Hold off other writes to the four tables for the few seconds this takes (reading carries on as normal).
  lock table public.assessments, public.questions, public.question_uploads, public.round_schedules in share row exclusive mode;

  select count(*) into b_assess from public.assessments where term_id = v_second;
  select count(*) into b_q from public.questions where term_id = v_second;
  select count(*) into b_up from public.question_uploads where term_id = v_second;
  select count(*) into b_cal from public.round_schedules where term_id = v_second;

  fp_before := jsonb_build_object(
    'assessments', pg_temp.fingerprint('public.assessments'), 'questions', pg_temp.fingerprint('public.questions'),
    'question_uploads', pg_temp.fingerprint('public.question_uploads'), 'round_schedules', pg_temp.fingerprint('public.round_schedules'));

  -- 4. The database normally stamps "last edited" on any update. Pause that for the move so edit times stay as they were.
  alter table public.assessments disable trigger assessments_touch;
  alter table public.questions disable trigger questions_touch;

  -- 5. The move: only the term changes, and every row moved is logged.
  with moved as (update public.assessments set term_id = v_first where term_id = v_second returning id)
  insert into public.term_move_log (batch, table_name, row_id, old_term_id, new_term_id) select v_batch, 'assessments', id, v_second, v_first from moved;
  get diagnostics c_assess = row_count;

  with moved as (update public.questions set term_id = v_first where term_id = v_second returning id)
  insert into public.term_move_log (batch, table_name, row_id, old_term_id, new_term_id) select v_batch, 'questions', id, v_second, v_first from moved;
  get diagnostics c_q = row_count;

  with moved as (update public.question_uploads set term_id = v_first where term_id = v_second returning id)
  insert into public.term_move_log (batch, table_name, row_id, old_term_id, new_term_id) select v_batch, 'question_uploads', id, v_second, v_first from moved;
  get diagnostics c_up = row_count;

  -- Exam calendar: one date per round and year group per term. A date that would clash with one already in First Term stays put.
  with moved as (
    update public.round_schedules rs set term_id = v_first
     where rs.term_id = v_second
       and not exists (select 1 from public.round_schedules f where f.term_id = v_first and f.round_id = rs.round_id and f.year_id = rs.year_id)
    returning id)
  insert into public.term_move_log (batch, table_name, row_id, old_term_id, new_term_id) select v_batch, 'round_schedules', id, v_second, v_first from moved;
  get diagnostics c_cal = row_count;
  select count(*) into c_cal_left from public.round_schedules where term_id = v_second;

  alter table public.assessments enable trigger assessments_touch;
  alter table public.questions enable trigger questions_touch;

  -- 6. Prove it: the counts match, and nothing but the term differs in any moved row.
  if c_assess <> b_assess or c_q <> b_q or c_up <> b_up or c_cal + c_cal_left <> b_cal then
    raise exception 'The numbers moved do not match the numbers found. Nothing was changed.';
  end if;
  fp_after := jsonb_build_object(
    'assessments', pg_temp.fingerprint('public.assessments'), 'questions', pg_temp.fingerprint('public.questions'),
    'question_uploads', pg_temp.fingerprint('public.question_uploads'), 'round_schedules', pg_temp.fingerprint('public.round_schedules'));
  if fp_before <> fp_after then
    raise exception 'A value other than the term would have changed. Nothing was changed. (%)', fp_before::text || ' vs ' || fp_after::text;
  end if;
  if exists (select 1 from public.assessments where term_id = v_second) then raise exception 'Some tests were left in Second Term. Nothing was changed.'; end if;

  -- 7. What followed along, for the record.
  select count(*) into n_attempts from public.attempts a join public.term_move_log l on l.row_id = a.assessment_id and l.batch = v_batch and l.table_name = 'assessments';
  select count(*) into n_windows from public.exam_windows w join public.term_move_log l on l.row_id = w.assessment_id and l.batch = v_batch and l.table_name = 'assessments';

  summary := jsonb_build_object(
    'session', v_session_name, 'moved_from', v_second_name, 'moved_to', v_first_name,
    'tests_moved', c_assess, 'questions_moved', c_q, 'question_banks_moved', c_up,
    'exam_calendar_dates_moved', c_cal, 'exam_calendar_dates_left_in_second_term_because_of_a_clash', c_cal_left,
    'results_that_followed_their_tests', n_attempts, 'exam_windows_that_followed_their_tests', n_windows,
    'check', 'passed: nothing but the term changed on any moved record', 'batch', v_batch);
  insert into public.audit_log (actor_id, action, entity, entity_id, detail) values (null, 'term.records_moved', 'term', v_second::text, summary);
  return summary;
end $fn$;

-- Run it for the current session. (To name the session instead: select ... move_second_term_to_first('2026/2027').)
select jsonb_pretty(pg_temp.move_second_term_to_first(null)) as result;
