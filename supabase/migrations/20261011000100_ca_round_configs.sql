-- Defines the school's vocabulary of CA rounds / sequence labels.
-- Super admins manage this list; teachers pick from it when creating tests.
-- The label value is what gets stored in assessments.sequence_label.

create table public.ca_round_configs (
  id         uuid    primary key default gen_random_uuid(),
  label      text    not null unique
               check (length(trim(label)) > 0 and length(label) <= 30),
  sort_order int     not null default 0,
  is_active  bool    not null default true,
  is_default bool    not null default false,
  created_at timestamptz not null default now()
);

comment on table public.ca_round_configs is
  'School-defined list of CA round labels (e.g. "1st CA", "Exam"). '
  'Teachers pick from this list when creating or editing a test.';

-- At most one row may be the default.
create unique index ca_round_configs_one_default
  on public.ca_round_configs (is_default)
  where is_default = true;

-- RLS: authenticated staff can read active rows; mutations use the service-role (admin) client.
alter table public.ca_round_configs enable row level security;

create policy "Staff can read active ca round configs"
  on public.ca_round_configs for select
  to authenticated
  using (is_active = true);

-- Seed with the five most common labels; 1st CA is the default.
insert into public.ca_round_configs (label, sort_order, is_default) values
  ('1st CA',   1, true),
  ('2nd CA',   2, false),
  ('3rd CA',   3, false),
  ('Mid-Term', 4, false),
  ('Exam',     5, false);
