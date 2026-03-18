-- PO Check-in schema for barcode scans and documents from the scanning web app.
-- Run this in the Supabase SQL Editor (Dashboard → SQL Editor → New query).

-- Barcode scans per PO (from your scanning web app).
create table if not exists public.po_barcodes (
  id uuid primary key default gen_random_uuid(),
  po_number text not null,
  barcode_value text not null,
  scanned_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

-- Documents (packing slips, paperwork) per PO. file_url can be a Supabase Storage public URL.
create table if not exists public.po_documents (
  id uuid primary key default gen_random_uuid(),
  po_number text not null,
  file_url text not null,
  document_type text not null default 'other',  -- e.g. 'packing_slip', 'paperwork', 'other'
  name text,
  scanned_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

-- Optional: index for fast lookups by PO.
create index if not exists idx_po_barcodes_po_number on public.po_barcodes (po_number);
create index if not exists idx_po_barcodes_scanned_at on public.po_barcodes (scanned_at desc);
create index if not exists idx_po_documents_po_number on public.po_documents (po_number);
create index if not exists idx_po_documents_scanned_at on public.po_documents (scanned_at desc);

-- Enable Row Level Security (RLS). Adjust policies to match your auth setup.
alter table public.po_barcodes enable row level security;
alter table public.po_documents enable row level security;

-- Allow public read for the Order Tracker app (so PO Info tab can load data).
-- Your scanning web app should use a service role key or authenticated user to INSERT.
create policy "Allow public read on po_barcodes"
  on public.po_barcodes for select
  using (true);

create policy "Allow public read on po_documents"
  on public.po_documents for select
  using (true);

-- Allow anonymous insert so the scanning app can push without auth (uses anon key).
-- "to anon" is required so the anon key is allowed to insert.
create policy "Allow anonymous insert on po_barcodes"
  on public.po_barcodes for insert to anon with check (true);

create policy "Allow anonymous insert on po_documents"
  on public.po_documents for insert to anon with check (true);
