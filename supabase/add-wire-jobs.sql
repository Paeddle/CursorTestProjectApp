-- Ongoing jobs list used by Wire Tracker and Wire Scanner.
-- Run once in Supabase SQL Editor.

create table if not exists public.wire_jobs (
  id bigint generated always as identity primary key,
  name text not null,
  name_key text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create unique index if not exists idx_wire_jobs_name_key_unique
  on public.wire_jobs (name_key);

create index if not exists idx_wire_jobs_active_name
  on public.wire_jobs (is_active, name);

alter table public.wire_jobs enable row level security;

drop policy if exists "Allow public read on wire_jobs" on public.wire_jobs;
create policy "Allow public read on wire_jobs"
  on public.wire_jobs for select
  using (true);

drop policy if exists "Allow insert on wire_jobs" on public.wire_jobs;
create policy "Allow insert on wire_jobs"
  on public.wire_jobs for insert
  with check (true);

drop policy if exists "Allow delete on wire_jobs" on public.wire_jobs;
create policy "Allow delete on wire_jobs"
  on public.wire_jobs for delete
  using (true);
