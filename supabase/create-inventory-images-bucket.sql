-- Product images for inventory labels (stable URLs in Supabase Storage).
-- Run in Supabase SQL Editor after add-inventory-picture-purchase-url.sql.

insert into storage.buckets (id, name, public)
values ('inventory-images', 'inventory-images', true)
on conflict (id) do nothing;

drop policy if exists "Allow anon upload inventory-images" on storage.objects;
create policy "Allow anon upload inventory-images"
  on storage.objects for insert
  to anon
  with check (bucket_id = 'inventory-images');

drop policy if exists "Allow anon update inventory-images" on storage.objects;
create policy "Allow anon update inventory-images"
  on storage.objects for update
  to anon
  using (bucket_id = 'inventory-images')
  with check (bucket_id = 'inventory-images');

drop policy if exists "Allow anon delete inventory-images" on storage.objects;
create policy "Allow anon delete inventory-images"
  on storage.objects for delete
  to anon
  using (bucket_id = 'inventory-images');

drop policy if exists "Allow public read inventory-images" on storage.objects;
create policy "Allow public read inventory-images"
  on storage.objects for select
  using (bucket_id = 'inventory-images');
