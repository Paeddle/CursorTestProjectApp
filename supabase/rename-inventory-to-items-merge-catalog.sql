-- Rename inventory → items, merge non-duplicate barcode_catalog rows, retire catalog table.
-- Run in Supabase SQL Editor after prior inventory + barcode_catalog migrations.

-- Catalog-only fields on the unified items table
alter table public.inventory add column if not exists notes text;
alter table public.inventory add column if not exists updated_at timestamptz not null default now();

drop trigger if exists set_inventory_updated_at on public.inventory;
create trigger set_inventory_updated_at
before update on public.inventory
for each row execute function public.set_updated_at();

-- Rename table
alter table public.inventory rename to items;

-- Indexes
alter index if exists idx_inventory_part_number rename to idx_items_part_number;
alter index if exists idx_inventory_barcode rename to idx_items_barcode;

-- RLS policies (recreate on items — names from add-purchase-list-inventory + add-inventory-management)
drop policy if exists "Allow public read on inventory" on public.items;
drop policy if exists "Allow anonymous insert on inventory" on public.items;
drop policy if exists "Allow anonymous delete on inventory" on public.items;
drop policy if exists "Allow anonymous update on inventory" on public.items;

create policy "Allow public read on items"
  on public.items for select using (true);

create policy "Allow anonymous insert on items"
  on public.items for insert with check (true);

create policy "Allow anonymous delete on items"
  on public.items for delete using (true);

create policy "Allow anonymous update on items"
  on public.items for update using (true) with check (true);

-- Upsert by barcode (PO Info / catalog saves)
create unique index if not exists idx_items_barcode_unique
  on public.items (barcode)
  where barcode is not null and trim(barcode) <> '';

-- Merge barcode_catalog rows not already matched by barcode or part number
insert into public.items (
  item,
  manufacturer,
  part_number,
  barcode,
  picture_url,
  purchase_url,
  notes,
  barcode_lookup_source,
  uploaded_at,
  created_at,
  updated_at
)
select
  bc.item_name,
  bc.manufacturer,
  nullif(trim(bc.part_number), ''),
  nullif(trim(bc.barcode_value), ''),
  bc.image_url,
  bc.product_url,
  bc.notes,
  'merged_from_barcode_catalog',
  coalesce(bc.created_at, now()),
  coalesce(bc.created_at, now()),
  coalesce(bc.updated_at, now())
from public.barcode_catalog bc
where not exists (
  select 1
  from public.items i
  where (
    nullif(trim(bc.barcode_value), '') is not null
    and nullif(trim(i.barcode), '') is not null
    and trim(i.barcode) = trim(bc.barcode_value)
  )
  or (
    nullif(trim(bc.part_number), '') is not null
    and nullif(trim(i.part_number), '') is not null
    and lower(trim(i.part_number)) = lower(trim(bc.part_number))
  )
);

drop table if exists public.barcode_catalog;
