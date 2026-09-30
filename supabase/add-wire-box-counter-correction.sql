-- Store a corrected remaining footage when the box counter prints a bad number.
-- current_footage stays the amount used for inventory and job math.
-- printed_footage is the number the counter showed. footage_note explains the correction.
-- Run in the Supabase SQL Editor.

alter table public.wire_box_scans
  add column if not exists printed_footage text,
  add column if not exists footage_note text;
