-- One-time data fix:
-- Force each box's earliest scan to be check_in (displayed as Intake in the app).
-- Safe to run multiple times.

with first_per_box as (
  select distinct on (lower(trim(box_id)))
    id
  from public.wire_box_scans
  where nullif(trim(box_id), '') is not null
  order by
    lower(trim(box_id)),
    scanned_at asc,
    id asc
)
update public.wire_box_scans w
set check_type = 'check_in'
from first_per_box f
where w.id = f.id
  and w.check_type <> 'check_in';
