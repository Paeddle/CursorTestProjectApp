-- Per-line customer/job pick when a PO item has multiple customers (shared across devices).
-- Run in Supabase SQL Editor.

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
