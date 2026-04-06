-- Optional profile on each scan row: wire type preset + full spool length (ft).
-- Set on first scan when initializing a new box in the wire scanner; copied on later scans for display.
-- Run in Supabase SQL Editor if wire_box_scans already exists.

alter table public.wire_box_scans
  add column if not exists wire_type text,
  add column if not exists spool_capacity_ft text;

comment on column public.wire_box_scans.wire_type is 'Preset id from wire scanner (e.g. 14-2-nm-b)';
comment on column public.wire_box_scans.spool_capacity_ft is 'Nominal full-spool footage for this physical box, in ft';
