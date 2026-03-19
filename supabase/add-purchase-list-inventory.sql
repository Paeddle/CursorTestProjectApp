-- Purchase List (Purchase Manager PDF exports) + Inventory (XLSX snapshot)
-- Run in Supabase SQL Editor after schema.sql.

-- One upload batch per PDF file (or per multi-file run from the app).
create table if not exists public.purchase_list_batches (
  id uuid primary key default gen_random_uuid(),
  source_filename text,
  created_at timestamptz not null default now()
);

-- Parsed line items from Purchase Manager export (Part + Required + context).
create table if not exists public.purchase_list_items (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.purchase_list_batches (id) on delete cascade,
  vendor text,
  part text not null,
  required integer not null default 0,
  received integer,
  ordered integer,
  cost text,
  context_line text,
  raw_line text,
  created_at timestamptz not null default now()
);

create index if not exists idx_purchase_list_items_batch_id on public.purchase_list_items (batch_id);
create index if not exists idx_purchase_list_items_part on public.purchase_list_items (part);

-- Inventory snapshot from XLSX (selected columns only). Latest upload replaces rows (app deletes then inserts).
create table if not exists public.inventory (
  id uuid primary key default gen_random_uuid(),
  manufacturer text,
  category text,
  type text,
  item text,
  part_number text,
  description_customer text,
  unit text,
  color text,
  unit_hard_cost numeric,
  unit_price numeric,
  margin numeric,
  markup numeric,
  id_class text,
  vendor_name text,
  barcode text,
  stock_total numeric,
  stock_available numeric,
  stock_on_order numeric,
  uploaded_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists idx_inventory_part_number on public.inventory (part_number);
create index if not exists idx_inventory_barcode on public.inventory (barcode);

-- RLS (same pattern as wire_box_scans: anon read + insert for the web app)
alter table public.purchase_list_batches enable row level security;
alter table public.purchase_list_items enable row level security;
alter table public.inventory enable row level security;

drop policy if exists "Allow public read on purchase_list_batches" on public.purchase_list_batches;
create policy "Allow public read on purchase_list_batches"
  on public.purchase_list_batches for select using (true);

drop policy if exists "Allow anonymous insert on purchase_list_batches" on public.purchase_list_batches;
create policy "Allow anonymous insert on purchase_list_batches"
  on public.purchase_list_batches for insert to anon with check (true);

drop policy if exists "Allow public read on purchase_list_items" on public.purchase_list_items;
create policy "Allow public read on purchase_list_items"
  on public.purchase_list_items for select using (true);

drop policy if exists "Allow anonymous insert on purchase_list_items" on public.purchase_list_items;
create policy "Allow anonymous insert on purchase_list_items"
  on public.purchase_list_items for insert to anon with check (true);

drop policy if exists "Allow public read on inventory" on public.inventory;
create policy "Allow public read on inventory"
  on public.inventory for select using (true);

drop policy if exists "Allow anonymous insert on inventory" on public.inventory;
create policy "Allow anonymous insert on inventory"
  on public.inventory for insert to anon with check (true);

-- Replace inventory on each XLSX upload
drop policy if exists "Allow anonymous delete on inventory" on public.inventory;
create policy "Allow anonymous delete on inventory"
  on public.inventory for delete to anon using (true);

-- Optional: remove mistaken purchase batches from the UI later
drop policy if exists "Allow anonymous delete on purchase_list_batches" on public.purchase_list_batches;
create policy "Allow anonymous delete on purchase_list_batches"
  on public.purchase_list_batches for delete to anon using (true);

drop policy if exists "Allow anonymous delete on purchase_list_items" on public.purchase_list_items;
create policy "Allow anonymous delete on purchase_list_items"
  on public.purchase_list_items for delete to anon using (true);
