-- Fix: "new row violates row-level security policy" when scanner app inserts.
-- Run this in Supabase → SQL Editor → New query, then Run.

-- Remove existing insert policies if they exist (avoids duplicate name errors).
drop policy if exists "Allow anonymous insert on po_barcodes" on public.po_barcodes;
drop policy if exists "Allow anonymous insert on po_documents" on public.po_documents;

-- Allow the anon key (scanner app) to insert rows.
create policy "Allow anonymous insert on po_barcodes"
  on public.po_barcodes
  for insert
  to anon
  with check (true);

create policy "Allow anonymous insert on po_documents"
  on public.po_documents
  for insert
  to anon
  with check (true);
