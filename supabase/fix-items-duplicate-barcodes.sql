-- Run this if rename-inventory-to-items-merge-catalog.sql failed on idx_items_barcode_unique.
-- Safe to re-run. Clears barcode on duplicate rows (keeps the "richest" row per barcode), then finishes migration.

-- Ensure items table exists (migration may have renamed inventory already)
alter table public.items add column if not exists notes text;
alter table public.items add column if not exists updated_at timestamptz not null default now();

drop trigger if exists set_inventory_updated_at on public.items;
drop trigger if exists set_items_updated_at on public.items;
create trigger set_items_updated_at
before update on public.items
for each row execute function public.set_updated_at();

-- Policies (idempotent)
drop policy if exists "Allow public read on inventory" on public.items;
drop policy if exists "Allow anonymous insert on inventory" on public.items;
drop policy if exists "Allow anonymous delete on inventory" on public.items;
drop policy if exists "Allow anonymous update on inventory" on public.items;

drop policy if exists "Allow public read on items" on public.items;
drop policy if exists "Allow anonymous insert on items" on public.items;
drop policy if exists "Allow anonymous delete on items" on public.items;
drop policy if exists "Allow anonymous update on items" on public.items;

create policy "Allow public read on items"
  on public.items for select using (true);

create policy "Allow anonymous insert on items"
  on public.items for insert with check (true);

create policy "Allow anonymous delete on items"
  on public.items for delete using (true);

create policy "Allow anonymous update on items"
  on public.items for update using (true) with check (true);

-- Clear duplicate barcodes: keep one row per trimmed barcode (best picture / newest data wins)
with ranked as (
  select
    id,
    trim(barcode) as barcode_key,
    row_number() over (
      partition by trim(barcode)
      order by
        (picture_path is not null and trim(picture_path) <> '') desc,
        (picture_url is not null and trim(picture_url) <> '') desc,
        (purchase_url is not null and trim(purchase_url) <> '') desc,
        updated_at desc nulls last,
        created_at asc
    ) as rn
  from public.items
  where barcode is not null and trim(barcode) <> ''
)
update public.items i
set
  barcode = null,
  notes = trim(
    coalesce(nullif(trim(i.notes), ''), '') ||
    case when nullif(trim(i.notes), '') is not null then E'\n' else '' end ||
    'Duplicate barcode ' || r.barcode_key || ' cleared (another row kept this barcode).'
  )
from ranked r
where i.id = r.id
  and r.rn > 1;

-- Preview duplicates before clearing (optional — comment out UPDATE above and run this instead):
-- select trim(barcode) as barcode, count(*) as cnt, array_agg(id order by created_at) as ids
-- from public.items
-- where barcode is not null and trim(barcode) <> ''
-- group by trim(barcode)
-- having count(*) > 1
-- order by cnt desc;

drop index if exists idx_items_barcode_unique;
create unique index idx_items_barcode_unique
  on public.items (barcode)
  where barcode is not null and trim(barcode) <> '';

-- Merge catalog (skip if barcode_catalog was already dropped)
do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'barcode_catalog'
  ) then
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

    drop table public.barcode_catalog;
  end if;
end $$;
