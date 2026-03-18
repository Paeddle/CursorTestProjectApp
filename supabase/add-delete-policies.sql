-- Allow delete on PO check-in tables and storage so the PO Info tab can remove items.
-- Run this in the Supabase SQL Editor after schema.sql.

-- Delete policies for po_barcodes and po_documents (anon can delete)
drop policy if exists "Allow anonymous delete on po_barcodes" on public.po_barcodes;
create policy "Allow anonymous delete on po_barcodes"
  on public.po_barcodes for delete to anon using (true);

drop policy if exists "Allow anonymous delete on po_documents" on public.po_documents;
create policy "Allow anonymous delete on po_documents"
  on public.po_documents for delete to anon using (true);

-- Allow anon to delete objects in po-documents bucket (so document delete can remove the file)
drop policy if exists "Allow anon delete po-documents" on storage.objects;
create policy "Allow anon delete po-documents"
  on storage.objects for delete
  to anon
  using (bucket_id = 'po-documents');
