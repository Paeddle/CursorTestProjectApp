-- Last barcode scan time per iPoint line (shared across devices).
-- Run in Supabase SQL Editor (or use add-po-info-line-sync.sql for all PO line tables).

create table if not exists public.po_line_last_scan (
  po_key text not null,
  item_key text not null,
  scanned_at timestamptz not null,
  updated_at timestamptz not null default now(),
  primary key (po_key, item_key)
);

create index if not exists idx_po_line_last_scan_po on public.po_line_last_scan (po_key);

alter table public.po_line_last_scan enable row level security;

drop policy if exists "Allow public read on po_line_last_scan" on public.po_line_last_scan;
create policy "Allow public read on po_line_last_scan"
  on public.po_line_last_scan for select using (true);

drop policy if exists "Allow insert on po_line_last_scan" on public.po_line_last_scan;
create policy "Allow insert on po_line_last_scan"
  on public.po_line_last_scan for insert with check (true);

drop policy if exists "Allow update on po_line_last_scan" on public.po_line_last_scan;
create policy "Allow update on po_line_last_scan"
  on public.po_line_last_scan for update using (true) with check (true);

drop policy if exists "Allow delete on po_line_last_scan" on public.po_line_last_scan;
create policy "Allow delete on po_line_last_scan"
  on public.po_line_last_scan for delete using (true);
