-- Allow updates on wire_box_scans (e.g. Wire Tracker changing wire type from the web app).
-- Without this, PostgREST can report success while RLS blocks the update (0 rows changed).
-- Run once in the Supabase SQL Editor.

drop policy if exists "Allow update on wire_box_scans" on public.wire_box_scans;

create policy "Allow update on wire_box_scans"
  on public.wire_box_scans for update
  to anon, authenticated
  using (true)
  with check (true);
