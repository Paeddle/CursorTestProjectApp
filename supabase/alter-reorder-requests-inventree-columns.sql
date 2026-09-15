-- Align reorder_requests columns with InvenTree naming.
-- Safe to re-run. Live tables still using part_number / item_name / manufacturer
-- will be renamed; missing columns are added.

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'reorder_requests' and column_name = 'manufacturer'
  ) then
    if not exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'reorder_requests' and column_name = 'category_name'
    ) then
      alter table public.reorder_requests add column category_name text;
    end if;
    update public.reorder_requests
    set category_name = manufacturer
    where category_name is null and manufacturer is not null;
  else
    alter table public.reorder_requests add column if not exists category_name text;
  end if;
end $$;

alter table public.reorder_requests drop column if exists manufacturer;
alter table public.reorder_requests drop column if exists stock_available;

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'reorder_requests' and column_name = 'part_number'
  ) and not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'reorder_requests' and column_name = 'ipn'
  ) then
    alter table public.reorder_requests rename column part_number to ipn;
  elsif not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'reorder_requests' and column_name = 'ipn'
  ) then
    alter table public.reorder_requests add column ipn text;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'reorder_requests' and column_name = 'item_name'
  ) and not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'reorder_requests' and column_name = 'name'
  ) then
    alter table public.reorder_requests rename column item_name to name;
  elsif not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'reorder_requests' and column_name = 'name'
  ) then
    alter table public.reorder_requests add column name text;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'reorder_requests' and column_name = 'description'
  ) and not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'reorder_requests' and column_name = 'link'
  ) then
    alter table public.reorder_requests rename column description to link;
  elsif not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'reorder_requests' and column_name = 'link'
  ) then
    alter table public.reorder_requests add column link text;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'reorder_requests' and column_name = 'barcode'
  ) and not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'reorder_requests' and column_name = 'barcode_hash'
  ) then
    alter table public.reorder_requests rename column barcode to barcode_hash;
  elsif not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'reorder_requests' and column_name = 'barcode_hash'
  ) then
    alter table public.reorder_requests add column barcode_hash text;
  end if;
end $$;

alter table public.reorder_requests add column if not exists ordered_at timestamptz;
alter table public.reorder_requests add column if not exists received_at timestamptz;

drop index if exists idx_reorder_requests_part_number;
create index if not exists idx_reorder_requests_ipn on public.reorder_requests (ipn);

comment on column public.reorder_requests.ipn is 'InvenTree IPN / internal part number.';
comment on column public.reorder_requests.category_name is 'InvenTree category name.';
comment on column public.reorder_requests.link is 'Product / purchase URL.';

drop policy if exists "Allow anonymous delete on reorder_requests" on public.reorder_requests;
create policy "Allow anonymous delete on reorder_requests"
  on public.reorder_requests for delete to anon
  using (true);
