-- Allow deleting received re-order rows from the portal Order history tab.
-- Run in the Supabase SQL Editor.

drop policy if exists "Allow anonymous delete on reorder_requests" on public.reorder_requests;
create policy "Allow anonymous delete on reorder_requests"
  on public.reorder_requests for delete to anon
  using (true);
