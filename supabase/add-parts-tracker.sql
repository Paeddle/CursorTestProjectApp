-- Parts Tracker / Parts Scanner
-- Catalog of unique parts plus a check-in history for each scan.
-- Run in the Supabase SQL Editor.

create table if not exists public.tracked_parts (
  id uuid primary key default gen_random_uuid(),
  manufacturer text,
  vendor text,
  upc_code text,
  part_name text,
  ipn text,
  description text,
  po text,
  link text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_tracked_parts_upc_code
  on public.tracked_parts (upc_code);

create index if not exists idx_tracked_parts_ipn
  on public.tracked_parts (ipn);

create index if not exists idx_tracked_parts_part_name
  on public.tracked_parts (part_name);

create unique index if not exists idx_tracked_parts_upc_unique
  on public.tracked_parts (upc_code)
  where trim(coalesce(upc_code, '')) <> '';

create unique index if not exists idx_tracked_parts_ipn_unique
  on public.tracked_parts (ipn)
  where trim(coalesce(ipn, '')) <> '';

comment on table public.tracked_parts is
  'Unique parts catalog used by Parts Tracker and Parts Scanner. Fields are optional.';

create or replace function public.set_tracked_parts_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_tracked_parts_updated_at on public.tracked_parts;
create trigger trg_tracked_parts_updated_at
  before update on public.tracked_parts
  for each row
  execute function public.set_tracked_parts_updated_at();

create table if not exists public.part_checkins (
  id uuid primary key default gen_random_uuid(),
  part_id uuid references public.tracked_parts (id) on delete set null,
  manufacturer text,
  vendor text,
  upc_code text,
  part_name text,
  ipn text,
  description text,
  po text,
  link text,
  check_in_date date not null default current_date,
  scanned_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists idx_part_checkins_scanned_at
  on public.part_checkins (scanned_at desc);

create index if not exists idx_part_checkins_check_in_date
  on public.part_checkins (check_in_date desc);

create index if not exists idx_part_checkins_part_id
  on public.part_checkins (part_id);

create index if not exists idx_part_checkins_upc_code
  on public.part_checkins (upc_code);

comment on table public.part_checkins is
  'Each Parts Scanner save is one check-in row (snapshot of fields at scan time).';

alter table public.tracked_parts enable row level security;
alter table public.part_checkins enable row level security;

drop policy if exists "Allow public read on tracked_parts" on public.tracked_parts;
create policy "Allow public read on tracked_parts"
  on public.tracked_parts for select
  using (true);

drop policy if exists "Allow insert on tracked_parts" on public.tracked_parts;
create policy "Allow insert on tracked_parts"
  on public.tracked_parts for insert
  to anon, authenticated
  with check (true);

drop policy if exists "Allow update on tracked_parts" on public.tracked_parts;
create policy "Allow update on tracked_parts"
  on public.tracked_parts for update
  to anon, authenticated
  using (true)
  with check (true);

drop policy if exists "Allow delete on tracked_parts" on public.tracked_parts;
create policy "Allow delete on tracked_parts"
  on public.tracked_parts for delete
  to anon, authenticated
  using (true);

drop policy if exists "Allow public read on part_checkins" on public.part_checkins;
create policy "Allow public read on part_checkins"
  on public.part_checkins for select
  using (true);

drop policy if exists "Allow insert on part_checkins" on public.part_checkins;
create policy "Allow insert on part_checkins"
  on public.part_checkins for insert
  to anon, authenticated
  with check (true);

drop policy if exists "Allow update on part_checkins" on public.part_checkins;
create policy "Allow update on part_checkins"
  on public.part_checkins for update
  to anon, authenticated
  using (true)
  with check (true);

drop policy if exists "Allow delete on part_checkins" on public.part_checkins;
create policy "Allow delete on part_checkins"
  on public.part_checkins for delete
  to anon, authenticated
  using (true);
