-- Allow updating catalog rows from the web app (anon or authenticated JWT).
-- Run in Supabase SQL Editor if catalog edits fail with RLS.

drop policy if exists "Allow anonymous update on barcode_catalog" on public.barcode_catalog;
create policy "Allow anonymous update on barcode_catalog"
  on public.barcode_catalog for update
  using (true)
  with check (true);
