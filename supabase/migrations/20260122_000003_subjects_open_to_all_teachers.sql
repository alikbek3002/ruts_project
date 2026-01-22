-- Adds a flag to allow subjects to be visible/usable for all teachers without explicit assignment.

alter table public.subjects
  add column if not exists open_to_all_teachers boolean not null default false;
