-- Approval rules per section: whether a teaching request with no clash is approved by itself.
-- ADDITIVE ONLY: one new column with a default. No existing row is otherwise changed.
alter table public.sections
  add column if not exists auto_approve_requests boolean not null default true;

comment on column public.sections.auto_approve_requests is
  'When true, a teacher''s request for a subject in a class that no other teacher has (or has asked for) is approved straight away. Clashes always wait for the Head of Section.';
