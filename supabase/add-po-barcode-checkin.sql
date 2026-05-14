-- Checked-in state per PO line (aggregated barcode) for the PO Info tab.
-- Run in Supabase SQL Editor after schema.sql.

create table if not exists public.po_barcode_checkin (
  id uuid primary key default gen_random_uuid(),
  po_number text not null,
  barcode_value text not null,
  checked_in boolean not null default true,
  updated_at timestamptz not null default now(),
  unique (po_number, barcode_value)
);

create index if not exists idx_po_barcode_checkin_po on public.po_barcode_checkin (po_number);

alter table public.po_barcode_checkin enable row level security;

drop policy if exists "Allow public read on po_barcode_checkin" on public.po_barcode_checkin;
create policy "Allow public read on po_barcode_checkin"
  on public.po_barcode_checkin for select
  using (true);

drop policy if exists "Allow insert on po_barcode_checkin" on public.po_barcode_checkin;
create policy "Allow insert on po_barcode_checkin"
  on public.po_barcode_checkin for insert
  with check (true);

drop policy if exists "Allow update on po_barcode_checkin" on public.po_barcode_checkin;
create policy "Allow update on po_barcode_checkin"
  on public.po_barcode_checkin for update
  using (true)
  with check (true);

drop policy if exists "Allow delete on po_barcode_checkin" on public.po_barcode_checkin;
create policy "Allow delete on po_barcode_checkin"
  on public.po_barcode_checkin for delete
  using (true);
