-- Add a free-text topic/unit label to assessments (e.g. "Fractions", "WWI").
-- Teachers must fill this in before submitting for approval.
alter table public.assessments add column if not exists topic text;
