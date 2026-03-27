-- Allow the Order Tracker Wire tab to delete wire_box_scans rows (single scan or whole box).
-- Run once in Supabase SQL Editor if the table exists without a delete policy.

drop policy if exists "Allow anonymous delete on wire_box_scans" on public.wire_box_scans;
create policy "Allow anonymous delete on wire_box_scans"
  on public.wire_box_scans for delete to anon using (true);
