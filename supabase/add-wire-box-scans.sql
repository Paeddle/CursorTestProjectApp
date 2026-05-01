-- Wire box scans: QR code (e.g. bx-1234) + job name + current footage
-- Run in Supabase SQL Editor after schema.sql. Same project as PO check-in.

create table if not exists public.wire_box_scans (
  id uuid primary key default gen_random_uuid(),
  box_id text not null,
  job_name text not null,
  current_footage text not null,
  check_type text not null default 'check_in'
    constraint wire_box_scans_check_type_chk check (check_type in ('check_in', 'check_out')),
  wire_type text,
  wire_type_label text,
  spool_capacity_ft text,
  scanned_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists idx_wire_box_scans_box_id on public.wire_box_scans (box_id);
create index if not exists idx_wire_box_scans_scanned_at on public.wire_box_scans (scanned_at desc);
create index if not exists idx_wire_box_scans_job_name on public.wire_box_scans (job_name);

alter table public.wire_box_scans enable row level security;

drop policy if exists "Allow public read on wire_box_scans" on public.wire_box_scans;
create policy "Allow public read on wire_box_scans"
  on public.wire_box_scans for select
  using (true);

drop policy if exists "Allow anonymous insert on wire_box_scans" on public.wire_box_scans;
drop policy if exists "Allow insert on wire_box_scans" on public.wire_box_scans;
create policy "Allow insert on wire_box_scans"
  on public.wire_box_scans for insert
  to anon, authenticated
  with check (true);

drop policy if exists "Allow anonymous delete on wire_box_scans" on public.wire_box_scans;
drop policy if exists "Allow delete on wire_box_scans" on public.wire_box_scans;
create policy "Allow delete on wire_box_scans"
  on public.wire_box_scans for delete
  to anon, authenticated
  using (true);

drop policy if exists "Allow update on wire_box_scans" on public.wire_box_scans;
create policy "Allow update on wire_box_scans"
  on public.wire_box_scans for update
  to anon, authenticated
  using (true)
  with check (true);
