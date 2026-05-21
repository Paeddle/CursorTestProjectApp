-- iPoint line "Check" strikethrough state (shared across devices for PO Info).
-- Run in Supabase SQL Editor after schema.sql.

create table if not exists public.po_line_checked (
  po_key text not null,
  item_key text not null,
  updated_at timestamptz not null default now(),
  primary key (po_key, item_key)
);

create index if not exists idx_po_line_checked_po_key on public.po_line_checked (po_key);

alter table public.po_line_checked enable row level security;

drop policy if exists "Allow public read on po_line_checked" on public.po_line_checked;
create policy "Allow public read on po_line_checked"
  on public.po_line_checked for select
  using (true);

drop policy if exists "Allow insert on po_line_checked" on public.po_line_checked;
create policy "Allow insert on po_line_checked"
  on public.po_line_checked for insert
  with check (true);

drop policy if exists "Allow update on po_line_checked" on public.po_line_checked;
create policy "Allow update on po_line_checked"
  on public.po_line_checked for update
  using (true)
  with check (true);

drop policy if exists "Allow delete on po_line_checked" on public.po_line_checked;
create policy "Allow delete on po_line_checked"
  on public.po_line_checked for delete
  using (true);
