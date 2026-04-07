-- Optional profile on each scan row: wire type preset + full spool length (ft).
-- Set on first scan when initializing a new box in the wire scanner; copied on later scans for display.
-- Run in Supabase SQL Editor if wire_box_scans already exists.

alter table public.wire_box_scans
  add column if not exists wire_type text,
  add column if not exists wire_type_label text,
  add column if not exists wire_type_default_ft text,
  add column if not exists spool_capacity_ft text;

comment on column public.wire_box_scans.wire_type is 'Wire type preset id from scanner (stable key)';
comment on column public.wire_box_scans.wire_type_label is 'Human-readable wire type name';
comment on column public.wire_box_scans.wire_type_default_ft is 'Catalog default reel length (ft) for that wire type at insert time';
comment on column public.wire_box_scans.spool_capacity_ft is 'Full spool length (ft) for this physical box';
