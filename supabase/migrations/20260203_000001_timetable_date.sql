-- Migration: Add specific date to timetable entries
-- Created: 2026-02-03
-- Description: Transition from recurring weekly schedule to date-based schedule.

-- Add lesson_date column
ALTER TABLE public.timetable_entries ADD COLUMN IF NOT EXISTS lesson_date DATE;

-- Index for date filtering
CREATE INDEX IF NOT EXISTS idx_timetable_lesson_date ON public.timetable_entries(lesson_date);

-- Comment
COMMENT ON COLUMN public.timetable_entries.lesson_date IS 'Specific date for the lesson. If set, lesson applies only to this date.';

-- Optional: You might want to populate lesson_date for existing entries if you want to freeze them?
-- For now, we leave them NULL (recurring) or handle them as legacy.
