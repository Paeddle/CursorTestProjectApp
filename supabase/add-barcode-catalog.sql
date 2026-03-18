-- Barcode Catalog for internal inventory lookups (Lutron/ADI/etc)
-- Run this in the Supabase SQL Editor after schema.sql.

create table if not exists public.barcode_catalog (
  id uuid primary key default gen_random_uuid(),
  barcode_value text not null,
  manufacturer text,
  item_name text not null,
  image_url text,
  product_url text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint barcode_catalog_barcode_unique unique (barcode_value)
);

create index if not exists idx_barcode_catalog_barcode_value on public.barcode_catalog (barcode_value);
create index if not exists idx_barcode_catalog_item_name on public.barcode_catalog (item_name);
create index if not exists idx_barcode_catalog_manufacturer on public.barcode_catalog (manufacturer);

alter table public.barcode_catalog enable row level security;

drop policy if exists "Allow public read on barcode_catalog" on public.barcode_catalog;
create policy "Allow public read on barcode_catalog"
  on public.barcode_catalog for select
  using (true);

drop policy if exists "Allow anonymous insert on barcode_catalog" on public.barcode_catalog;
create policy "Allow anonymous insert on barcode_catalog"
  on public.barcode_catalog for insert to anon with check (true);

-- Keep updated_at current
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_barcode_catalog_updated_at on public.barcode_catalog;
create trigger set_barcode_catalog_updated_at
before update on public.barcode_catalog
for each row execute function public.set_updated_at();

