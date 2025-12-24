-- Timetable improvements: add room column for lessons

alter table public.timetable_entries
  add column if not exists room text null;
