-- Add optional part number to barcode catalog (run in Supabase SQL Editor if the table already exists).

alter table public.barcode_catalog add column if not exists part_number text;

create index if not exists idx_barcode_catalog_part_number on public.barcode_catalog (part_number);
