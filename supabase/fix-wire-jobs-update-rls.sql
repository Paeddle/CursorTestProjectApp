-- Allow updates on wire_jobs (Wire Tracker bulk check-out / add job uses upsert).
-- INSERT ... ON CONFLICT DO UPDATE needs an UPDATE policy even for a new job name.
-- Without this, Postgres returns:
--   new row violates row-level security policy (USING expression) for table "wire_jobs"
-- Run once in the Supabase SQL Editor.

drop policy if exists "Allow update on wire_jobs" on public.wire_jobs;

create policy "Allow update on wire_jobs"
  on public.wire_jobs for update
  to anon, authenticated
  using (true)
  with check (true);
