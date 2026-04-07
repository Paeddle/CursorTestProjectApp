-- Human-readable wire type name and catalog default reel length (ft), stored on each scan row.
-- Run in Supabase SQL Editor if wire_box_scans already exists.

alter table public.wire_box_scans
  add column if not exists wire_type_label text,
  add column if not exists wire_type_default_ft text;

comment on column public.wire_box_scans.wire_type is 'Wire type preset id from scanner (stable key)';
comment on column public.wire_box_scans.wire_type_label is 'Display name for the wire type (e.g. Cat6 550MHz Blue)';
comment on column public.wire_box_scans.wire_type_default_ft is 'Catalog default full reel length in ft for that wire type at scan time';
comment on column public.wire_box_scans.spool_capacity_ft is 'Actual full spool length in ft for this box (may differ from catalog default)';
