-- Re-order request form submissions (tag scanner app).
-- Run in Supabase SQL Editor or: npx supabase db query --linked -f supabase/add-reorder-requests.sql
-- Then run supabase/alter-reorder-requests-inventree-columns.sql if upgrading an older table.

create table if not exists public.reorder_requests (
  id uuid primary key default gen_random_uuid(),
  item_id uuid references public.items(id) on delete set null,
  ipn text,
  name text,
  category_name text,
  vendor_name text,
  barcode_hash text,
  link text,
  quantity integer not null check (quantity > 0),
  job text,
  requested_by text,
  notes text,
  status text not null default 'pending' check (status in ('pending', 'ordered', 'received', 'cancelled')),
  ordered_at timestamptz,
  received_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_reorder_requests_ipn on public.reorder_requests (ipn);
create index if not exists idx_reorder_requests_status on public.reorder_requests (status);
create index if not exists idx_reorder_requests_created_at on public.reorder_requests (created_at desc);

create or replace function public.set_reorder_requests_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_reorder_requests_updated_at on public.reorder_requests;
create trigger trg_reorder_requests_updated_at
  before update on public.reorder_requests
  for each row
  execute function public.set_reorder_requests_updated_at();

alter table public.reorder_requests enable row level security;

drop policy if exists "Allow public read on reorder_requests" on public.reorder_requests;
create policy "Allow public read on reorder_requests"
  on public.reorder_requests for select
  using (true);

drop policy if exists "Allow anonymous insert on reorder_requests" on public.reorder_requests;
create policy "Allow anonymous insert on reorder_requests"
  on public.reorder_requests for insert to anon
  with check (true);

drop policy if exists "Allow anonymous update on reorder_requests" on public.reorder_requests;
create policy "Allow anonymous update on reorder_requests"
  on public.reorder_requests for update to anon
  using (true) with check (true);
