-- Canonical stored image for labels (Supabase Storage path in inventory-images bucket).
-- Run in Supabase SQL Editor after create-inventory-images-bucket.sql.

alter table public.inventory add column if not exists picture_path text;
