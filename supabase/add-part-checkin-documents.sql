-- Quantity + documents on part check-ins, plus a storage bucket for scanned files.
-- Run in the Supabase SQL Editor.

alter table public.part_checkins
  add column if not exists quantity integer not null default 1;

alter table public.part_checkins
  add column if not exists documents jsonb not null default '[]'::jsonb;

comment on column public.part_checkins.quantity is
  'How many of this part were checked in.';

comment on column public.part_checkins.documents is
  'Array of {name, url} objects for packing slips or other scanned files.';

insert into storage.buckets (id, name, public)
values ('checkin-documents', 'checkin-documents', true)
on conflict (id) do nothing;

drop policy if exists "Allow anon upload checkin-documents" on storage.objects;
create policy "Allow anon upload checkin-documents"
  on storage.objects for insert
  to anon, authenticated
  with check (bucket_id = 'checkin-documents');

drop policy if exists "Allow public read checkin-documents" on storage.objects;
create policy "Allow public read checkin-documents"
  on storage.objects for select
  using (bucket_id = 'checkin-documents');

drop policy if exists "Allow anon delete checkin-documents" on storage.objects;
create policy "Allow anon delete checkin-documents"
  on storage.objects for delete
  to anon, authenticated
  using (bucket_id = 'checkin-documents');
