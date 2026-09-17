-- Tag D-Tools library rows so warehouse-only parts never mix into the sync CSV.
alter table public.dtools_products
  add column if not exists source text not null default 'dtools';

comment on column public.dtools_products.source is
  'dtools = imported from D-Tools Cloud. local rows must not be exported back to D-Tools.';
