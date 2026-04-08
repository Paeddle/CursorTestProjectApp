-- Idempotent wire_box_scans profile columns used by the wire scanner and Wire page.
-- Adds wire_type, spool_capacity_ft, wire_type_label if missing.
-- Run in Supabase SQL Editor after wire_box_scans exists.

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'wire_box_scans'
      and column_name = 'wire_type'
  ) then
    alter table public.wire_box_scans add column wire_type text;
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'wire_box_scans'
      and column_name = 'spool_capacity_ft'
  ) then
    alter table public.wire_box_scans add column spool_capacity_ft text;
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'wire_box_scans'
      and column_name = 'wire_type_label'
  ) then
    alter table public.wire_box_scans add column wire_type_label text;
  end if;
end $$;

comment on column public.wire_box_scans.wire_type is 'Wire type preset id from scanner (stable key)';
comment on column public.wire_box_scans.spool_capacity_ft is 'Full spool length (ft) for this physical box';
comment on column public.wire_box_scans.wire_type_label is 'Display name for the wire type (e.g. Cat6 550MHz Blue)';
