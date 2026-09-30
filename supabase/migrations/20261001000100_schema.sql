-- Lekki Peculiar CBT — core schema
-- Conventions: uuid PKs, timestamptz everywhere, snake_case, soft "active" flags for people/records
-- that reports depend on (never hard-delete academic history).

create extension if not exists pgcrypto;
create schema if not exists extensions;
create extension if not exists pg_trgm with schema extensions;
create extension if not exists fuzzystrmatch with schema extensions;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.staff_role as enum ('super_admin', 'admin', 'teacher');
create type public.assessment_type as enum ('test', 'exam', 'mock', 'practice');
create type public.assessment_status as enum ('draft', 'pending_approval', 'changes_requested', 'approved', 'archived');
create type public.window_status as enum ('scheduled', 'live', 'paused', 'closed');
create type public.attempt_status as enum ('in_progress', 'submitted', 'voided');

-- ---------------------------------------------------------------------------
-- Helpers used by generated columns
-- ---------------------------------------------------------------------------
-- Admission numbers are matched loosely: case, spaces, dashes, slashes and leading zeros
-- in each number group are ignored, so "lps/2024/0137", "LPS 2024 137" and "LPS-2024-137"
-- are all the same key.
create or replace function public.normalize_admission(raw text)
returns text
language sql
immutable
parallel safe
as $$
  select upper(
    regexp_replace(
      regexp_replace(coalesce(raw, ''), '(^|[^0-9])0+([0-9])', '\1\2', 'g'),
      '[^A-Za-z0-9]', '', 'g'
    )
  )
$$;

-- ---------------------------------------------------------------------------
-- School structure
-- ---------------------------------------------------------------------------
create table public.schools (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  short_name text,
  created_at timestamptz not null default now()
);

create table public.sections (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  code text not null,
  name text not null,
  cbt_enabled boolean not null default true,
  logo_url text,
  accent_color text,
  sort int not null default 0,
  unique (school_id, code)
);

create table public.years (
  id uuid primary key default gen_random_uuid(),
  section_id uuid not null references public.sections (id) on delete cascade,
  name text not null,
  level int not null,
  stage text check (stage in ('junior', 'senior')),
  unique (section_id, level)
);

create table public.tracks (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  name text not null,
  unique (school_id, name)
);

create table public.classes (
  id uuid primary key default gen_random_uuid(),
  year_id uuid not null references public.years (id) on delete restrict,
  name text not null,
  track_id uuid references public.tracks (id) on delete set null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (year_id, name)
);

create table public.academic_sessions (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  name text not null,
  is_current boolean not null default false,
  unique (school_id, name)
);

create table public.terms (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.academic_sessions (id) on delete cascade,
  name text not null,
  ordinal int not null check (ordinal between 1 and 3),
  is_current boolean not null default false,
  unique (session_id, ordinal)
);

create table public.subjects (
  id uuid primary key default gen_random_uuid(),
  section_id uuid not null references public.sections (id) on delete restrict,
  name text not null,
  code text,
  active boolean not null default true,
  unique (section_id, name)
);

-- ---------------------------------------------------------------------------
-- Staff, scopes and permissions
-- ---------------------------------------------------------------------------
create table public.staff (
  id uuid primary key references auth.users (id) on delete cascade,
  school_id uuid not null references public.schools (id) on delete cascade,
  email text not null unique,
  full_name text not null,
  role public.staff_role not null default 'teacher',
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Admins (Heads of Section) are scoped to one or more sections: Elementary and/or College.
create table public.admin_sections (
  staff_id uuid not null references public.staff (id) on delete cascade,
  section_id uuid not null references public.sections (id) on delete cascade,
  primary key (staff_id, section_id)
);

-- Granular permissions granted by the super admin. Super admins implicitly hold all of them.
create table public.staff_permissions (
  staff_id uuid not null references public.staff (id) on delete cascade,
  permission text not null check (permission in (
    'exam.approve',        -- approve assessments and schedule exam windows
    'exam.start',          -- start / pause / resume / close exam windows
    'exam.extend_time',    -- give extra time to a class or a student
    'exam.grant_makeup',   -- open an exam for students who missed it
    'attempt.unlock',      -- allow a student to continue on a different computer
    'attempt.void',        -- void an attempt (with reason), optionally allowing a retake
    'students.manage',     -- create / import / edit students and photos
    'teachers.manage',     -- approve teaching assignments
    'terminals.manage'     -- register lab computers as exam terminals
  )),
  granted_by uuid references public.staff (id) on delete set null,
  granted_at timestamptz not null default now(),
  primary key (staff_id, permission)
);

create table public.teaching_assignments (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.staff (id) on delete cascade,
  subject_id uuid not null references public.subjects (id) on delete cascade,
  class_id uuid not null references public.classes (id) on delete cascade,
  session_id uuid not null references public.academic_sessions (id) on delete cascade,
  status text not null default 'requested' check (status in ('requested', 'approved', 'rejected')),
  requested_at timestamptz not null default now(),
  decided_by uuid references public.staff (id) on delete set null,
  decided_at timestamptz,
  unique (teacher_id, subject_id, class_id, session_id)
);
create index on public.teaching_assignments (subject_id, class_id) where status = 'approved';

-- ---------------------------------------------------------------------------
-- Students (no login accounts — they identify at a registered lab terminal)
-- ---------------------------------------------------------------------------
create table public.students (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  admission_no text not null,
  admission_key text generated always as (public.normalize_admission(admission_no)) stored,
  first_name text not null,
  last_name text not null,
  other_names text,
  gender text check (gender in ('M', 'F')),
  class_id uuid references public.classes (id) on delete set null,
  photo_path text,
  active boolean not null default true,
  search_name text generated always as (
    lower(first_name || ' ' || last_name || ' ' || coalesce(other_names, ''))
  ) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (school_id, admission_key)
);
create index on public.students (class_id) where active;
create index students_search_trgm on public.students using gin (search_name extensions.gin_trgm_ops);
create index students_admission_trgm on public.students using gin (admission_key extensions.gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- Question bank
-- ---------------------------------------------------------------------------
create table public.questions (
  id uuid primary key default gen_random_uuid(),
  subject_id uuid not null references public.subjects (id) on delete restrict,
  year_id uuid references public.years (id) on delete set null,
  owner_id uuid not null references public.staff (id) on delete restrict,
  body text not null check (length(trim(body)) > 0),
  -- [{ "key": "A", "text": "..." }, ...] — 2 to 6 options
  options jsonb not null check (
    jsonb_typeof(options) = 'array' and jsonb_array_length(options) between 2 and 6
  ),
  answer text not null check (answer ~ '^[A-F]$'),
  topic text,
  difficulty smallint check (difficulty between 1 and 3),
  explanation text,
  image_url text,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.questions (subject_id) where not archived;

-- ---------------------------------------------------------------------------
-- Assessments (tests, exams, mocks, practice)
-- ---------------------------------------------------------------------------
create table public.assessments (
  id uuid primary key default gen_random_uuid(),
  subject_id uuid not null references public.subjects (id) on delete restrict,
  year_id uuid not null references public.years (id) on delete restrict,
  term_id uuid not null references public.terms (id) on delete restrict,
  title text not null,
  type public.assessment_type not null default 'test',
  status public.assessment_status not null default 'draft',
  question_count int not null check (question_count between 1 and 200),
  duration_minutes int not null check (duration_minutes between 1 and 600),
  -- shuffle_questions, shuffle_options, require_all_answered, allow_flag, allow_back,
  -- show_result ('none'|'score'|'full'), pass_mark (percent), marks_per_question, instructions
  settings jsonb not null default '{}'::jsonb,
  -- Frozen copy of questions + answer key taken at approval. Grading always uses this.
  paper jsonb,
  created_by uuid not null references public.staff (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  submitted_at timestamptz,
  reviewed_by uuid references public.staff (id) on delete set null,
  reviewed_at timestamptz,
  review_note text
);
create index on public.assessments (subject_id, term_id);

create table public.assessment_questions (
  assessment_id uuid not null references public.assessments (id) on delete cascade,
  question_id uuid not null references public.questions (id) on delete restrict,
  position int not null default 0,
  primary key (assessment_id, question_id)
);

-- One sitting of an assessment for one class. Nobody can start outside an open window.
create table public.exam_windows (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid not null references public.assessments (id) on delete cascade,
  class_id uuid not null references public.classes (id) on delete restrict,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  -- true = admin pre-authorised the scheduled start; false = an admin must press Start.
  auto_start boolean not null default false,
  status public.window_status not null default 'scheduled',
  extra_minutes int not null default 0,
  -- how long after a student's deadline offline answers may still be uploaded
  sync_cutoff_minutes int not null default 60,
  created_by uuid references public.staff (id) on delete set null,
  created_at timestamptz not null default now(),
  started_by uuid references public.staff (id) on delete set null,
  started_at timestamptz,
  closed_at timestamptz,
  check (ends_at > starts_at),
  unique (assessment_id, class_id)
);
create index on public.exam_windows (class_id, starts_at);

-- Per-student exceptions: make-ups, extra time, permission to continue on another computer.
create table public.exam_exceptions (
  id uuid primary key default gen_random_uuid(),
  window_id uuid not null references public.exam_windows (id) on delete cascade,
  student_id uuid not null references public.students (id) on delete cascade,
  kind text not null check (kind in ('makeup', 'extra_time', 'relogin_unlock')),
  opens_at timestamptz,
  closes_at timestamptz,
  extra_minutes int not null default 0,
  reason text not null check (length(trim(reason)) > 0),
  granted_by uuid references public.staff (id) on delete set null,
  created_at timestamptz not null default now(),
  consumed_at timestamptz
);
create index on public.exam_exceptions (student_id, window_id);

-- ---------------------------------------------------------------------------
-- Lab terminals (registered computers that may run the student exam screen)
-- ---------------------------------------------------------------------------
create table public.lab_terminals (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  name text not null,
  token_hash text not null unique,
  active boolean not null default true,
  registered_by uuid references public.staff (id) on delete set null,
  registered_at timestamptz not null default now(),
  last_seen_at timestamptz
);

create table public.terminal_codes (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  code_hash text not null unique,
  expires_at timestamptz not null,
  created_by uuid references public.staff (id) on delete set null,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Attempts
-- ---------------------------------------------------------------------------
create table public.attempts (
  id uuid primary key default gen_random_uuid(),
  window_id uuid not null references public.exam_windows (id) on delete restrict,
  assessment_id uuid not null references public.assessments (id) on delete restrict,
  student_id uuid not null references public.students (id) on delete restrict,
  class_id uuid references public.classes (id) on delete set null,
  status public.attempt_status not null default 'in_progress',
  is_makeup boolean not null default false,
  login_method text not null default 'admission_no' check (login_method in ('admission_no', 'name_search', 'resume')),
  terminal_id uuid references public.lab_terminals (id) on delete set null,
  -- [{ "q": question_id, "o": ["C","A","D","B"] }] — per-student question and option order
  question_order jsonb not null,
  started_at timestamptz not null default now(),
  deadline timestamptz not null,
  submitted_at timestamptz,
  submit_source text check (submit_source in ('student', 'timeout', 'auto_finalize', 'admin')),
  last_sync_at timestamptz,
  late_sync boolean not null default false,
  focus_losses int not null default 0,
  relogins int not null default 0,
  total_questions int not null,
  answered_count int,
  correct_count int,
  score numeric(7, 2),
  max_score numeric(7, 2),
  voided_by uuid references public.staff (id) on delete set null,
  voided_reason text,
  created_at timestamptz not null default now()
);
create unique index attempts_one_live_per_window on public.attempts (window_id, student_id) where status <> 'voided';
create index on public.attempts (assessment_id);
create index on public.attempts (student_id);

create table public.attempt_answers (
  attempt_id uuid not null references public.attempts (id) on delete cascade,
  question_id uuid not null,
  selected text check (selected is null or selected ~ '^[A-F]$'),
  flagged boolean not null default false,
  answered_at timestamptz not null,
  received_at timestamptz not null default now(),
  primary key (attempt_id, question_id)
);

create table public.attempt_events (
  id bigint generated always as identity primary key,
  attempt_id uuid references public.attempts (id) on delete cascade,
  student_id uuid references public.students (id) on delete cascade,
  terminal_id uuid references public.lab_terminals (id) on delete set null,
  type text not null,
  detail jsonb,
  created_at timestamptz not null default now()
);
create index on public.attempt_events (attempt_id);

-- ---------------------------------------------------------------------------
-- Audit trail (append-only)
-- ---------------------------------------------------------------------------
create table public.audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid,
  action text not null,
  entity text not null,
  entity_id text,
  detail jsonb,
  created_at timestamptz not null default now()
);
create index on public.audit_log (created_at desc);

-- ---------------------------------------------------------------------------
-- Integrity triggers
-- ---------------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger students_touch before update on public.students
  for each row execute function public.touch_updated_at();
create trigger questions_touch before update on public.questions
  for each row execute function public.touch_updated_at();
create trigger assessments_touch before update on public.assessments
  for each row execute function public.touch_updated_at();

-- Answers can never change once an attempt is submitted or voided.
create or replace function public.guard_attempt_answers()
returns trigger language plpgsql as $$
declare
  st public.attempt_status;
begin
  select status into st from public.attempts
   where id = coalesce(new.attempt_id, old.attempt_id);
  if st is distinct from 'in_progress' and current_setting('app.grading', true) is distinct from 'on' then
    raise exception 'attempt is %; answers are locked', st using errcode = 'P0001';
  end if;
  return coalesce(new, old);
end $$;

create trigger attempt_answers_guard before insert or update or delete on public.attempt_answers
  for each row execute function public.guard_attempt_answers();

-- A submitted attempt cannot go back to in_progress; its identity and timing are frozen.
create or replace function public.guard_attempts()
returns trigger language plpgsql as $$
begin
  if old.status <> 'in_progress' then
    if new.status = 'in_progress' then
      raise exception 'a finished attempt cannot be reopened' using errcode = 'P0001';
    end if;
    if new.student_id <> old.student_id or new.window_id <> old.window_id
       or new.started_at <> old.started_at or new.submitted_at is distinct from old.submitted_at
       or new.question_order <> old.question_order then
      raise exception 'finished attempts are immutable' using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;

create trigger attempts_guard before update on public.attempts
  for each row execute function public.guard_attempts();

-- Audit log is append-only.
create or replace function public.guard_audit_log()
returns trigger language plpgsql as $$
begin
  raise exception 'audit log is append-only' using errcode = 'P0001';
end $$;

create trigger audit_log_guard before update or delete on public.audit_log
  for each row execute function public.guard_audit_log();
