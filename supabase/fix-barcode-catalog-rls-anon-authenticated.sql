-- Catalog insert/update was limited to role "anon". Logged-in users use "authenticated"
-- and failed upserts/edits with: new row violates row-level security policy ...
-- Run this in the Supabase SQL Editor on existing projects.

drop policy if exists "Allow anonymous insert on barcode_catalog" on public.barcode_catalog;
create policy "Allow anonymous insert on barcode_catalog"
  on public.barcode_catalog for insert
  with check (true);

drop policy if exists "Allow anonymous update on barcode_catalog" on public.barcode_catalog;
create policy "Allow anonymous update on barcode_catalog"
  on public.barcode_catalog for update
  using (true)
  with check (true);
