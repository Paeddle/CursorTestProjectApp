-- Personal time clock punches. Run once in the Supabase SQL Editor.
-- The app is unlisted (not linked from the home login page).

create table if not exists public.time_punches (
  id uuid primary key,
  action text not null check (action in ('in', 'out')),
  punched_at timestamptz not null,
  note text not null default '',
  job text not null default '',
  day_only boolean not null default false,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists idx_time_punches_punched_at
  on public.time_punches (punched_at desc);

alter table public.time_punches enable row level security;

drop policy if exists "Allow public read on time_punches" on public.time_punches;
create policy "Allow public read on time_punches"
  on public.time_punches for select
  using (true);

drop policy if exists "Allow insert on time_punches" on public.time_punches;
create policy "Allow insert on time_punches"
  on public.time_punches for insert
  with check (true);

drop policy if exists "Allow update on time_punches" on public.time_punches;
create policy "Allow update on time_punches"
  on public.time_punches for update
  using (true)
  with check (true);
