-- D-Tools Cloud product library (CSVFiles/Products.csv).
-- Used by Parts Tracker (Parts tab) and Check-In Scanner typeahead.
-- Apply: npx supabase db query --linked --project-ref bunxqkvirdultswdrhnx -f supabase/add-dtools-products.sql

create table if not exists public.dtools_products (
  id uuid primary key default gen_random_uuid(),
  csv_row integer not null unique,
  brand text,
  model text,
  part_number text,
  short_description text,
  description text,
  category text,
  keywords text,
  image_url text,
  msrp text,
  unit_cost text,
  unit_price text,
  taxable text,
  supplier text,
  system text,
  phase text,
  upc text,
  ean text,
  itf text,
  quantity_on_hand text,
  minimum_stock_level text,
  reorder_level text,
  discontinued text,
  height text,
  width text,
  depth text,
  weight text,
  rack_mounted text,
  rack_units text,
  amps text,
  volts text,
  watts text,
  btu text,
  installation_hours text,
  tax text,
  unit_of_measure text,
  margin text,
  markup text,
  length_based text,
  inventory_value text,
  inherited_labor_items text,
  inherited_accessories text,
  item_dtin text,
  active text,
  created_date text,
  modified_date text,
  imported_at timestamptz not null default now()
);

create index if not exists idx_dtools_products_brand on public.dtools_products (brand);
create index if not exists idx_dtools_products_model on public.dtools_products (model);
create index if not exists idx_dtools_products_part_number on public.dtools_products (part_number);
create index if not exists idx_dtools_products_upc on public.dtools_products (upc);
create index if not exists idx_dtools_products_ean on public.dtools_products (ean);
create index if not exists idx_dtools_products_supplier on public.dtools_products (supplier);
create index if not exists idx_dtools_products_category on public.dtools_products (category);

comment on table public.dtools_products is
  'Full D-Tools Cloud library export. Text columns keep CSV values as exported.';

alter table public.dtools_products enable row level security;

drop policy if exists "Allow public read on dtools_products" on public.dtools_products;
create policy "Allow public read on dtools_products"
  on public.dtools_products for select
  using (true);

drop policy if exists "Allow insert on dtools_products" on public.dtools_products;
create policy "Allow insert on dtools_products"
  on public.dtools_products for insert
  to anon, authenticated
  with check (true);

drop policy if exists "Allow update on dtools_products" on public.dtools_products;
create policy "Allow update on dtools_products"
  on public.dtools_products for update
  to anon, authenticated
  using (true)
  with check (true);

drop policy if exists "Allow delete on dtools_products" on public.dtools_products;
create policy "Allow delete on dtools_products"
  on public.dtools_products for delete
  to anon, authenticated
  using (true);
