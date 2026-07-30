-- Align reorder_requests columns with InvenTree naming.
-- Run in Supabase SQL Editor after add-reorder-requests.sql.

-- category_name (was storing category in manufacturer)
alter table public.reorder_requests add column if not exists category_name text;
update public.reorder_requests
set category_name = manufacturer
where category_name is null and manufacturer is not null;
alter table public.reorder_requests drop column if exists manufacturer;

alter table public.reorder_requests drop column if exists stock_available;

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'reorder_requests' and column_name = 'part_number'
  ) then
    alter table public.reorder_requests rename column part_number to ipn;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'reorder_requests' and column_name = 'item_name'
  ) then
    alter table public.reorder_requests rename column item_name to name;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'reorder_requests' and column_name = 'description'
  ) then
    alter table public.reorder_requests rename column description to link;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'reorder_requests' and column_name = 'barcode'
  ) then
    alter table public.reorder_requests rename column barcode to barcode_hash;
  end if;
end $$;

alter table public.reorder_requests add column if not exists ordered_at timestamptz;
alter table public.reorder_requests add column if not exists received_at timestamptz;

drop index if exists idx_reorder_requests_part_number;
create index if not exists idx_reorder_requests_ipn on public.reorder_requests (ipn);

comment on column public.reorder_requests.ipn is 'InvenTree IPN / internal part number.';
comment on column public.reorder_requests.category_name is 'InvenTree category name.';
comment on column public.reorder_requests.link is 'Product / purchase URL.';
