-- Non-inventory orders synced from Google Sheets "Raw Data" tab.
-- Run once in Supabase SQL Editor.

create table if not exists public.non_inventory_orders (
  id uuid primary key default gen_random_uuid(),
  google_row_number integer not null unique,
  sheet_timestamp text,
  item_name text,
  part_number text,
  quantity numeric,
  item_url text,
  ordered boolean not null default false,
  received boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_non_inventory_orders_row on public.non_inventory_orders (google_row_number);
create index if not exists idx_non_inventory_orders_updated on public.non_inventory_orders (updated_at desc);

create or replace function public.set_non_inventory_orders_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_non_inventory_orders_updated_at on public.non_inventory_orders;
create trigger trg_non_inventory_orders_updated_at
before update on public.non_inventory_orders
for each row execute function public.set_non_inventory_orders_updated_at();

alter table public.non_inventory_orders enable row level security;

drop policy if exists "Allow public read non_inventory_orders" on public.non_inventory_orders;
create policy "Allow public read non_inventory_orders"
  on public.non_inventory_orders for select
  using (true);

drop policy if exists "Allow public insert non_inventory_orders" on public.non_inventory_orders;
create policy "Allow public insert non_inventory_orders"
  on public.non_inventory_orders for insert to anon
  with check (true);

drop policy if exists "Allow public update non_inventory_orders" on public.non_inventory_orders;
create policy "Allow public update non_inventory_orders"
  on public.non_inventory_orders for update to anon
  using (true)
  with check (true);

drop policy if exists "Allow public delete non_inventory_orders" on public.non_inventory_orders;
create policy "Allow public delete non_inventory_orders"
  on public.non_inventory_orders for delete to anon
  using (true);
