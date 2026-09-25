-- Job name + all-day entries (holiday / sick day) on personal time punches.
-- Run once in the Supabase SQL Editor if time_punches already exists.

alter table public.time_punches
  add column if not exists job text not null default '';

alter table public.time_punches
  add column if not exists day_only boolean not null default false;
