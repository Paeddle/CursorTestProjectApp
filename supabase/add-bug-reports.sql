-- Bug reports from the SHS home / intro page.
-- Run once in Supabase SQL Editor.

create table if not exists public.bug_reports (
  id bigint generated always as identity primary key,
  reporter_name text not null,
  comment text not null,
  page_url text,
  user_agent text,
  created_at timestamptz not null default now()
);

create index if not exists idx_bug_reports_created_at
  on public.bug_reports (created_at desc);

alter table public.bug_reports enable row level security;

drop policy if exists "Allow public read on bug_reports" on public.bug_reports;
create policy "Allow public read on bug_reports"
  on public.bug_reports for select
  using (true);

drop policy if exists "Allow insert on bug_reports" on public.bug_reports;
create policy "Allow insert on bug_reports"
  on public.bug_reports for insert
  with check (true);
