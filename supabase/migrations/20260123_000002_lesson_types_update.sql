-- Migration: Update Lesson Types
-- Created: 2026-01-23
-- Description: Renames lesson types:
--   'practical' -> 'seminar'
--   'theoretical' -> 'lecture'

-- 1. Disable constraints temporarily to allow updates
ALTER TABLE public.timetable_entries DROP CONSTRAINT IF EXISTS timetable_entries_lesson_type_check;
ALTER TABLE public.curriculum_template_items DROP CONSTRAINT IF EXISTS curriculum_template_items_lesson_type_check;

-- 2. Update data in timetable_entries
UPDATE public.timetable_entries 
SET lesson_type = 'seminar' 
WHERE lesson_type = 'practical';

UPDATE public.timetable_entries 
SET lesson_type = 'lecture' 
WHERE lesson_type = 'theoretical';

-- 3. Update data in curriculum_template_items
UPDATE public.curriculum_template_items 
SET lesson_type = 'seminar' 
WHERE lesson_type = 'practical';

UPDATE public.curriculum_template_items 
SET lesson_type = 'lecture' 
WHERE lesson_type = 'theoretical';

-- 4. Re-enable constraints with new values
ALTER TABLE public.timetable_entries 
ADD CONSTRAINT timetable_entries_lesson_type_check 
CHECK (lesson_type IN ('lecture', 'seminar', 'credit'));

ALTER TABLE public.curriculum_template_items 
ADD CONSTRAINT curriculum_template_items_lesson_type_check 
CHECK (lesson_type IN ('lecture', 'seminar', 'credit'));

-- 5. Update comments/defaults if necessary
ALTER TABLE public.timetable_entries 
ALTER COLUMN lesson_type SET DEFAULT 'lecture';

-- 6. Update view comments or definitions if needed
-- (No views depend strictly on the enum values as string literals in constraints, but logic might)
