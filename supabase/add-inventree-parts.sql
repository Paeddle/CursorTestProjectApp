-- InvenTree part export mirror (from InvenTree_Part_*.csv).
-- Run in Supabase SQL Editor or: npx supabase db query --linked -f supabase/add-inventree-parts.sql
--
-- CSV column mapping:
--   Name            -> name
--   Creation Date   -> creation_date
--   Active          -> active
--   Barcode Hash    -> barcode_hash
--   Category Name   -> category_name
--   IPN             -> ipn
--   Link            -> link
--   Maximum Stock   -> maximum_stock
--
-- inventree_id is the InvenTree "ID" column — use it as the upsert key when you automate imports.

create table if not exists public.inventree_parts (
  id uuid primary key default gen_random_uuid(),
  inventree_id integer not null,
  name text not null,
  creation_date date,
  active boolean not null default true,
  barcode_hash text,
  category_name text,
  ipn text,
  link text,
  maximum_stock numeric,
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint inventree_parts_inventree_id_key unique (inventree_id)
);

create index if not exists idx_inventree_parts_ipn on public.inventree_parts (ipn);
create index if not exists idx_inventree_parts_category_name on public.inventree_parts (category_name);
create index if not exists idx_inventree_parts_active on public.inventree_parts (active);
create index if not exists idx_inventree_parts_synced_at on public.inventree_parts (synced_at desc);

comment on table public.inventree_parts is
  'Mirror of selected InvenTree part fields; refresh via CSV/API automation using inventree_id upserts.';
comment on column public.inventree_parts.inventree_id is 'InvenTree part primary key (CSV column ID).';
comment on column public.inventree_parts.ipn is 'InvenTree Internal Part Number; matches reorder-app SKU lookups.';
comment on column public.inventree_parts.maximum_stock is 'InvenTree Maximum Stock from CSV column Maximum Stock.';

create or replace function public.set_inventree_parts_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_inventree_parts_updated_at on public.inventree_parts;
create trigger trg_inventree_parts_updated_at
  before update on public.inventree_parts
  for each row
  execute function public.set_inventree_parts_updated_at();

alter table public.inventree_parts enable row level security;

drop policy if exists "Allow public read on inventree_parts" on public.inventree_parts;
create policy "Allow public read on inventree_parts"
  on public.inventree_parts for select
  using (true);

drop policy if exists "Allow anonymous insert on inventree_parts" on public.inventree_parts;
create policy "Allow anonymous insert on inventree_parts"
  on public.inventree_parts for insert to anon
  with check (true);

drop policy if exists "Allow anonymous update on inventree_parts" on public.inventree_parts;
create policy "Allow anonymous update on inventree_parts"
  on public.inventree_parts for update to anon
  using (true) with check (true);

drop policy if exists "Allow anonymous delete on inventree_parts" on public.inventree_parts;
create policy "Allow anonymous delete on inventree_parts"
  on public.inventree_parts for delete to anon
  using (true);

-- Example upsert for future automation (one row):
-- insert into public.inventree_parts (
--   inventree_id, name, creation_date, active, barcode_hash, category_name, ipn, link, maximum_stock, synced_at
-- ) values (
--   132, '1-Gang Blank Plate Legrand - Black', '2026-07-07', true, null, 'Consumables', 'TP13BK',
--   'https://www.adiglobaldistribution.us/Product/pass-seymour-tp-00-000?option=H4-TP13BK', 20.0, now()
-- )
-- on conflict (inventree_id) do update set
--   name = excluded.name,
--   creation_date = excluded.creation_date,
--   active = excluded.active,
--   barcode_hash = excluded.barcode_hash,
--   category_name = excluded.category_name,
--   ipn = excluded.ipn,
--   link = excluded.link,
--   maximum_stock = excluded.maximum_stock,
--   synced_at = excluded.synced_at;
