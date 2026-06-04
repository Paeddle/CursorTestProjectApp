-- Inventory: product image URL and where-to-buy link.
-- Run in Supabase SQL Editor after add-inventory-management.sql.

alter table public.inventory add column if not exists picture_url text;
alter table public.inventory add column if not exists purchase_url text;
