-- iPoint import data for PO Info: job refs, PO line report lines, item room locations.
-- Run in Supabase SQL Editor after schema.sql.

-- Maps 4-digit ref (filename like 4152.xlsx) → job name from JobRef export.
create table if not exists public.po_job_refs (
  id uuid primary key default gen_random_uuid(),
  job_name text not null,
  ref_number text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint po_job_refs_ref_number_unique unique (ref_number)
);

create index if not exists idx_po_job_refs_job_name on public.po_job_refs (job_name);

-- PO line items from POLineReport (iPoint export).
create table if not exists public.po_line_items (
  id uuid primary key default gen_random_uuid(),
  po_number text not null,
  item_name text not null,
  job_or_customer text,
  po_date date,
  quantity text,
  source_file text,
  imported_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists idx_po_line_items_po_number on public.po_line_items (po_number);
create index if not exists idx_po_line_items_item_name on public.po_line_items (item_name);
create index if not exists idx_po_line_items_job on public.po_line_items (job_or_customer);

-- Room locations per job ref (from 4152.xlsx-style exports).
create table if not exists public.po_item_locations (
  id uuid primary key default gen_random_uuid(),
  ref_number text not null,
  location_name text not null,
  manufacturer text,
  product_name text not null,
  quantity numeric,
  source_file text,
  imported_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists idx_po_item_locations_ref on public.po_item_locations (ref_number);
create index if not exists idx_po_item_locations_product on public.po_item_locations (product_name);

alter table public.po_job_refs enable row level security;
alter table public.po_line_items enable row level security;
alter table public.po_item_locations enable row level security;

-- Read
drop policy if exists "Allow public read on po_job_refs" on public.po_job_refs;
create policy "Allow public read on po_job_refs"
  on public.po_job_refs for select using (true);

drop policy if exists "Allow public read on po_line_items" on public.po_line_items;
create policy "Allow public read on po_line_items"
  on public.po_line_items for select using (true);

drop policy if exists "Allow public read on po_item_locations" on public.po_item_locations;
create policy "Allow public read on po_item_locations"
  on public.po_item_locations for select using (true);

-- Insert / update / delete (anon, same pattern as barcode_catalog)
drop policy if exists "Allow anonymous insert on po_job_refs" on public.po_job_refs;
create policy "Allow anonymous insert on po_job_refs"
  on public.po_job_refs for insert with check (true);

drop policy if exists "Allow anonymous update on po_job_refs" on public.po_job_refs;
create policy "Allow anonymous update on po_job_refs"
  on public.po_job_refs for update using (true) with check (true);

drop policy if exists "Allow anonymous delete on po_job_refs" on public.po_job_refs;
create policy "Allow anonymous delete on po_job_refs"
  on public.po_job_refs for delete using (true);

drop policy if exists "Allow anonymous insert on po_line_items" on public.po_line_items;
create policy "Allow anonymous insert on po_line_items"
  on public.po_line_items for insert with check (true);

drop policy if exists "Allow anonymous delete on po_line_items" on public.po_line_items;
create policy "Allow anonymous delete on po_line_items"
  on public.po_line_items for delete using (true);

drop policy if exists "Allow anonymous insert on po_item_locations" on public.po_item_locations;
create policy "Allow anonymous insert on po_item_locations"
  on public.po_item_locations for insert with check (true);

drop policy if exists "Allow anonymous delete on po_item_locations" on public.po_item_locations;
create policy "Allow anonymous delete on po_item_locations"
  on public.po_item_locations for delete using (true);

-- updated_at helper (same as barcode_catalog migration)
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_po_job_refs_updated_at on public.po_job_refs;
create trigger set_po_job_refs_updated_at
before update on public.po_job_refs
for each row execute function public.set_updated_at();
