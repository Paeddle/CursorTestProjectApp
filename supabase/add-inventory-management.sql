-- Inventory management: edit rows in the web app + barcode lookup metadata.
-- Run in Supabase SQL Editor after add-purchase-list-inventory.sql.

alter table public.inventory add column if not exists barcode_lookup_source text;
alter table public.inventory add column if not exists barcode_lookup_at timestamptz;

create index if not exists idx_inventory_missing_barcode
  on public.inventory (part_number)
  where barcode is null or trim(barcode) = '';

-- Allow the web app to update inventory rows (barcode fill, manual edits).
drop policy if exists "Allow anonymous update on inventory" on public.inventory;
create policy "Allow anonymous update on inventory"
  on public.inventory for update to anon
  using (true) with check (true);

-- barcode_catalog: allow update for catalog maintenance from Inventory page.
drop policy if exists "Allow anonymous update on barcode_catalog" on public.barcode_catalog;
create policy "Allow anonymous update on barcode_catalog"
  on public.barcode_catalog for update to anon
  using (true) with check (true);
