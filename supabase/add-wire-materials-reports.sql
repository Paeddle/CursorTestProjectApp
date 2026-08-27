-- Saved materials-used reports from Wire Tracker.
-- Run once in Supabase SQL Editor.

create table if not exists public.wire_materials_reports (
  id uuid primary key default gen_random_uuid(),
  job_name text not null,
  count_empty_boxes boolean not null default false,
  rows jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_wire_materials_reports_created_at
  on public.wire_materials_reports (created_at desc);

alter table public.wire_materials_reports enable row level security;

drop policy if exists "Allow public read on wire_materials_reports" on public.wire_materials_reports;
create policy "Allow public read on wire_materials_reports"
  on public.wire_materials_reports for select
  using (true);

drop policy if exists "Allow insert on wire_materials_reports" on public.wire_materials_reports;
create policy "Allow insert on wire_materials_reports"
  on public.wire_materials_reports for insert
  to anon, authenticated
  with check (true);

drop policy if exists "Allow delete on wire_materials_reports" on public.wire_materials_reports;
create policy "Allow delete on wire_materials_reports"
  on public.wire_materials_reports for delete
  to anon, authenticated
  using (true);
