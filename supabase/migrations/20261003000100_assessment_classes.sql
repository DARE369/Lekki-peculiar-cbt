-- The classes (arms) a teacher made a test or exam for, e.g. Year 7 Gold and Year 7 Blue.
-- Pre-ticked when the Head of Section schedules it; empty means "not specified".
alter table public.assessments add column class_ids uuid[] not null default '{}';
