-- Warehouse product catalog for barcode collection walks.
-- Run in Supabase SQL Editor or: npx supabase db query --linked -f supabase/add-warehouse-catalog-items.sql
--
-- Used by warehouse-catalog-app to capture part number, name, UPC/EAN, vendor,
-- manufacturer, category, and maximum stock while walking the warehouse.

create table if not exists public.warehouse_catalog_items (
  id uuid primary key default gen_random_uuid(),
  part_number text,
  name text,
  upc_code text,
  alt_upc_code text,
  vendor text,
  manufacturer text,
  category text,
  maximum_stock numeric,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_warehouse_catalog_part_number
  on public.warehouse_catalog_items (part_number);

create index if not exists idx_warehouse_catalog_name
  on public.warehouse_catalog_items (name);

create index if not exists idx_warehouse_catalog_upc_code
  on public.warehouse_catalog_items (upc_code);

create index if not exists idx_warehouse_catalog_alt_upc_code
  on public.warehouse_catalog_items (alt_upc_code);

create unique index if not exists idx_warehouse_catalog_upc_unique
  on public.warehouse_catalog_items (upc_code)
  where trim(coalesce(upc_code, '')) <> '';

create unique index if not exists idx_warehouse_catalog_alt_upc_unique
  on public.warehouse_catalog_items (alt_upc_code)
  where trim(coalesce(alt_upc_code, '')) <> '';

comment on table public.warehouse_catalog_items is
  'Warehouse product catalog collected via warehouse-catalog-app; most fields optional.';

comment on column public.warehouse_catalog_items.upc_code is
  'Primary UPC-A or similar product barcode (digits only recommended).';

comment on column public.warehouse_catalog_items.alt_upc_code is
  'Alternate barcode such as EAN-13, inner-pack UPC, or vendor code.';

create or replace function public.set_warehouse_catalog_items_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_warehouse_catalog_items_updated_at on public.warehouse_catalog_items;
create trigger trg_warehouse_catalog_items_updated_at
  before update on public.warehouse_catalog_items
  for each row
  execute function public.set_warehouse_catalog_items_updated_at();

alter table public.warehouse_catalog_items enable row level security;

drop policy if exists "Allow public read on warehouse_catalog_items" on public.warehouse_catalog_items;
create policy "Allow public read on warehouse_catalog_items"
  on public.warehouse_catalog_items for select
  using (true);

drop policy if exists "Allow anonymous insert on warehouse_catalog_items" on public.warehouse_catalog_items;
create policy "Allow anonymous insert on warehouse_catalog_items"
  on public.warehouse_catalog_items for insert to anon
  with check (true);

drop policy if exists "Allow anonymous update on warehouse_catalog_items" on public.warehouse_catalog_items;
create policy "Allow anonymous update on warehouse_catalog_items"
  on public.warehouse_catalog_items for update to anon
  using (true) with check (true);

drop policy if exists "Allow anonymous delete on warehouse_catalog_items" on public.warehouse_catalog_items;
create policy "Allow anonymous delete on warehouse_catalog_items"
  on public.warehouse_catalog_items for delete to anon
  using (true);
