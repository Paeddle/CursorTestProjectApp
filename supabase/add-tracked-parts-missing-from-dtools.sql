-- Flag warehouse-only parts that still need to be added to D-Tools.
-- Run in the Supabase SQL Editor.

alter table public.tracked_parts
  add column if not exists missing_from_dtools boolean not null default false;

comment on column public.tracked_parts.missing_from_dtools is
  'Warehouse-only part that still needs to be added to the D-Tools library.';

create index if not exists idx_tracked_parts_missing_from_dtools
  on public.tracked_parts (missing_from_dtools)
  where missing_from_dtools;
