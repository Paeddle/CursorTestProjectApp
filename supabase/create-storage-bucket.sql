-- Create the po-documents storage bucket and allow scanner app to upload.
-- Run this in Supabase → SQL Editor → New query → Run.

-- 1. Create the bucket (id must match what the app uses: po-documents)
-- Create bucket (ignore if it already exists)
insert into storage.buckets (id, name, public)
values ('po-documents', 'po-documents', true)
on conflict (id) do nothing;

-- 2. Allow anon to upload (scanner app uses anon key)
drop policy if exists "Allow anon uploads to po-documents" on storage.objects;
create policy "Allow anon uploads to po-documents"
  on storage.objects for insert
  to anon
  with check (bucket_id = 'po-documents');

-- 3. Allow public read (so document links work in PO Info tab)
drop policy if exists "Allow public read po-documents" on storage.objects;
create policy "Allow public read po-documents"
  on storage.objects for select
  to anon
  using (bucket_id = 'po-documents');
