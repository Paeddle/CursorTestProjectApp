-- Wire type catalog for scanner dropdown / Wire Tracker editor.
-- Soft-delete via is_active = false (keeps history on old scans).
-- Run once in Supabase SQL Editor.

create table if not exists public.wire_types (
  id text primary key,
  label text not null,
  default_capacity_ft integer not null check (default_capacity_ft > 0),
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_wire_types_active_sort
  on public.wire_types (is_active, sort_order, label);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_wire_types_updated_at on public.wire_types;
create trigger set_wire_types_updated_at
before update on public.wire_types
for each row execute function public.set_updated_at();

alter table public.wire_types enable row level security;

drop policy if exists "Allow public read on wire_types" on public.wire_types;
create policy "Allow public read on wire_types"
  on public.wire_types for select
  using (true);

drop policy if exists "Allow insert on wire_types" on public.wire_types;
create policy "Allow insert on wire_types"
  on public.wire_types for insert
  to anon, authenticated
  with check (true);

drop policy if exists "Allow update on wire_types" on public.wire_types;
create policy "Allow update on wire_types"
  on public.wire_types for update
  to anon, authenticated
  using (true)
  with check (true);

-- Seed current hardcoded presets (safe to re-run)
insert into public.wire_types (id, label, default_capacity_ft, is_active, sort_order)
values
  ('rg6-quad-shield', 'RG-6 Quad Shield', 500, true, 10),
  ('cat6-550mhz-blue', 'Cat6 550MHz Blue', 1000, true, 20),
  ('cat6-550mhz-gray', 'Cat6 550MHz Gray', 1000, true, 30),
  ('cat6-550mhz-white', 'Cat6 550MHz White', 1000, true, 40),
  ('cat6-550mhz-black', 'Cat6 550MHz Black', 1000, true, 50),
  ('cat6a-slim', 'Cat6A Slim', 1000, true, 60),
  ('cat7', 'Cat7', 1000, true, 70),
  ('cat8', 'Cat8', 1000, true, 80),
  ('optical-fiber-cable', 'Optical Fiber Cable', 1000, true, 90),
  ('lutron-green', 'Lutron Green', 1000, true, 100),
  ('lutron-qs-m', 'Lutron QS/M', 1000, true, 110),
  ('18-4cs-security-wire', '18-4CS Security Wire', 500, true, 120),
  ('18-2cs-security-wire', '18-2CS Security Wire', 500, true, 130),
  ('22-4-stranded-security-wire', '22-4 Stranded Security Wire', 1000, true, 140),
  ('22-2-stranded-security-wire', '22-2 Stranded Security Wire', 1000, true, 150),
  ('16-2fx-db-speaker-wire', '16-2FX DB Speaker Wire', 500, true, 160),
  ('16-4fx-db-speaker-wire', '16-4FX DB Speaker Wire', 500, true, 170),
  ('14-2fx-db-speaker-wire', '14-2FX DB Speaker Wire', 500, true, 180),
  ('14-4fx-db-speaker-wire', '14-4FX DB Speaker Wire', 500, true, 190),
  ('12-2fx-db-speaker-wire', '12-2FX DB Speaker Wire', 500, true, 200),
  ('12-4fx-db-speaker-wire', '12-4FX DB Speaker Wire', 500, true, 210)
on conflict (id) do nothing;
