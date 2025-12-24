-- Allow timetable entries without assigned teacher
-- Needed to save timetable even when a subject has no teacher assignment.

ALTER TABLE public.timetable_entries
  ALTER COLUMN teacher_id DROP NOT NULL;
