-- eBay inventory scans from the eBay scanner app + enrichment links to items.
-- Run in Supabase SQL Editor after items table exists.

create table if not exists public.ebay_scans (
  id uuid primary key default gen_random_uuid(),
  barcode_value text not null,
  item_id uuid references public.items(id) on delete set null,
  scanned_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists idx_ebay_scans_barcode on public.ebay_scans (barcode_value);
create index if not exists idx_ebay_scans_item_id on public.ebay_scans (item_id);
create index if not exists idx_ebay_scans_scanned_at on public.ebay_scans (scanned_at desc);

alter table public.ebay_scans enable row level security;

drop policy if exists "Allow public read on ebay_scans" on public.ebay_scans;
create policy "Allow public read on ebay_scans"
  on public.ebay_scans for select
  using (true);

drop policy if exists "Allow anonymous insert on ebay_scans" on public.ebay_scans;
create policy "Allow anonymous insert on ebay_scans"
  on public.ebay_scans for insert to anon
  with check (true);

drop policy if exists "Allow anonymous update on ebay_scans" on public.ebay_scans;
create policy "Allow anonymous update on ebay_scans"
  on public.ebay_scans for update to anon
  using (true) with check (true);

drop policy if exists "Allow anonymous delete on ebay_scans" on public.ebay_scans;
create policy "Allow anonymous delete on ebay_scans"
  on public.ebay_scans for delete to anon
  using (true);
