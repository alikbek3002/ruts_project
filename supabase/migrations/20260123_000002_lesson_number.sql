-- Add lesson_number field to timetable_entries
-- This allows manual numbering of lessons (e.g., "ЛЕКЦИЯ 5")

ALTER TABLE public.timetable_entries
  ADD COLUMN IF NOT EXISTS lesson_number integer;

COMMENT ON COLUMN public.timetable_entries.lesson_number IS 'Manual lesson number override (e.g., 5 for "ЛЕКЦИЯ 5")';
