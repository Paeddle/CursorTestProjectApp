-- Remote Dymo print queue: tablet queues labels; laptop Print Station prints via DYMO Connect.
-- Run in Supabase SQL Editor after schema.sql / add-po-ipoint-import.sql.

create table if not exists public.label_print_queue (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null default gen_random_uuid(),
  po_number text not null,
  item_name text not null,
  job_name text,
  location_name text,
  label_key text,
  barcode_value text,
  status text not null default 'pending'
    check (status in ('pending', 'printing', 'done', 'failed')),
  error_message text,
  created_at timestamptz not null default now(),
  processed_at timestamptz
);

create index if not exists idx_label_print_queue_pending
  on public.label_print_queue (created_at asc)
  where status = 'pending';

create index if not exists idx_label_print_queue_batch
  on public.label_print_queue (batch_id);

alter table public.label_print_queue enable row level security;

drop policy if exists "Allow public read on label_print_queue" on public.label_print_queue;
create policy "Allow public read on label_print_queue"
  on public.label_print_queue for select using (true);

drop policy if exists "Allow anonymous insert on label_print_queue" on public.label_print_queue;
create policy "Allow anonymous insert on label_print_queue"
  on public.label_print_queue for insert with check (true);

drop policy if exists "Allow anonymous update on label_print_queue" on public.label_print_queue;
create policy "Allow anonymous update on label_print_queue"
  on public.label_print_queue for update using (true) with check (true);

-- Realtime: enable replication for the print station page (Dashboard → Database → Replication if this fails).
alter table public.label_print_queue replica identity full;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'label_print_queue'
  ) then
    alter publication supabase_realtime add table public.label_print_queue;
  end if;
exception
  when duplicate_object then null;
end $$;
