-- Allow the Wire tab / scanner to delete wire_box_scans (anon or authenticated JWT role).
-- Run in Supabase SQL Editor if deletes do nothing: old policies often used "TO anon" only.

drop policy if exists "Allow anonymous delete on wire_box_scans" on public.wire_box_scans;
drop policy if exists "Allow delete on wire_box_scans" on public.wire_box_scans;
create policy "Allow delete on wire_box_scans"
  on public.wire_box_scans for delete
  to anon, authenticated
  using (true);
