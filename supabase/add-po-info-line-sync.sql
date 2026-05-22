-- PO Info iPoint line state shared across devices (run once in Supabase SQL Editor).
-- Creates: po_line_checked, po_line_customer_pick, po_line_received

-- Check column (strikethrough)
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
  on public.po_line_checked for select using (true);
drop policy if exists "Allow insert on po_line_checked" on public.po_line_checked;
create policy "Allow insert on po_line_checked"
  on public.po_line_checked for insert with check (true);
drop policy if exists "Allow update on po_line_checked" on public.po_line_checked;
create policy "Allow update on po_line_checked"
  on public.po_line_checked for update using (true) with check (true);
drop policy if exists "Allow delete on po_line_checked" on public.po_line_checked;
create policy "Allow delete on po_line_checked"
  on public.po_line_checked for delete using (true);

-- Multi-customer picker
create table if not exists public.po_line_customer_pick (
  po_key text not null,
  item_key text not null,
  job_or_customer text not null,
  updated_at timestamptz not null default now(),
  primary key (po_key, item_key)
);
create index if not exists idx_po_line_customer_pick_po on public.po_line_customer_pick (po_key);
alter table public.po_line_customer_pick enable row level security;
drop policy if exists "Allow public read on po_line_customer_pick" on public.po_line_customer_pick;
create policy "Allow public read on po_line_customer_pick"
  on public.po_line_customer_pick for select using (true);
drop policy if exists "Allow insert on po_line_customer_pick" on public.po_line_customer_pick;
create policy "Allow insert on po_line_customer_pick"
  on public.po_line_customer_pick for insert with check (true);
drop policy if exists "Allow update on po_line_customer_pick" on public.po_line_customer_pick;
create policy "Allow update on po_line_customer_pick"
  on public.po_line_customer_pick for update using (true) with check (true);
drop policy if exists "Allow delete on po_line_customer_pick" on public.po_line_customer_pick;
create policy "Allow delete on po_line_customer_pick"
  on public.po_line_customer_pick for delete using (true);

-- Here column (partial receive qty)
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
