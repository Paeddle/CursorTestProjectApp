-- How many units of each iPoint line are physically on hand (partial receive).
-- Run in Supabase SQL Editor.

create table if not exists public.po_line_received (
  po_key text not null,
  item_key text not null,
  received_qty integer not null default 0 check (received_qty >= 0),
  updated_at timestamptz not null default now(),
  primary key (po_key, item_key)
);

create index if not exists idx_po_line_received_po on public.po_line_received (po_key);

alter table public.po_line_received enable row level security;

drop policy if exists "Allow public read on po_line_received" on public.po_line_received;
create policy "Allow public read on po_line_received"
  on public.po_line_received for select using (true);

drop policy if exists "Allow insert on po_line_received" on public.po_line_received;
create policy "Allow insert on po_line_received"
  on public.po_line_received for insert with check (true);

drop policy if exists "Allow update on po_line_received" on public.po_line_received;
create policy "Allow update on po_line_received"
  on public.po_line_received for update using (true) with check (true);

drop policy if exists "Allow delete on po_line_received" on public.po_line_received;
create policy "Allow delete on po_line_received"
  on public.po_line_received for delete using (true);
