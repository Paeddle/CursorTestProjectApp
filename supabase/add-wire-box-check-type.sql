-- Add check-in vs check-out to existing wire_box_scans (run once in Supabase SQL Editor
-- if you already created the table from an older add-wire-box-scans.sql).

alter table public.wire_box_scans
  add column if not exists check_type text not null default 'check_in';

alter table public.wire_box_scans
  drop constraint if exists wire_box_scans_check_type_chk;

alter table public.wire_box_scans
  add constraint wire_box_scans_check_type_chk
  check (check_type in ('check_in', 'check_out'));
