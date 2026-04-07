-- Adds wire_type_label and wire_type_default_ft to wire_box_scans.
-- Safe if columns already exist (e.g. you already ran add-wire-box-profile-columns.sql).
-- Run in Supabase SQL Editor after wire_box_scans exists.

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'wire_box_scans'
      and column_name = 'wire_type_label'
  ) then
    alter table public.wire_box_scans add column wire_type_label text;
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'wire_box_scans'
      and column_name = 'wire_type_default_ft'
  ) then
    alter table public.wire_box_scans add column wire_type_default_ft text;
  end if;
end $$;

comment on column public.wire_box_scans.wire_type_label is 'Display name for the wire type (e.g. Cat6 550MHz Blue)';
comment on column public.wire_box_scans.wire_type_default_ft is 'Catalog default full reel length in ft for that wire type at scan time';
