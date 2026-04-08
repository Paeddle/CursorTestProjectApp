-- Removes redundant wire_type_default_ft (full spool is only spool_capacity_ft).
-- Run once in Supabase SQL Editor after deploying apps and sync-wire-inventory that no longer use this column.

alter table public.wire_box_scans drop column if exists wire_type_default_ft;
