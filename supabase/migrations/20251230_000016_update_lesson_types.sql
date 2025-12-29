-- Update lesson_type enum values
-- Change from 'lecture', 'credit' to 'theoretical', 'practical', 'credit'

-- 1. Update existing 'lecture' values to 'theoretical'
UPDATE public.timetable_entries 
SET lesson_type = 'theoretical' 
WHERE lesson_type = 'lecture';

UPDATE public.curriculum_template_items 
SET lesson_type = 'theoretical' 
WHERE lesson_type = 'lecture';

-- 2. Drop old constraints
ALTER TABLE public.timetable_entries 
DROP CONSTRAINT IF EXISTS timetable_entries_lesson_type_check;

ALTER TABLE public.curriculum_template_items 
DROP CONSTRAINT IF EXISTS curriculum_template_items_lesson_type_check;

-- 3. Add new constraints with updated values
ALTER TABLE public.timetable_entries 
ADD CONSTRAINT timetable_entries_lesson_type_check 
CHECK (lesson_type IN ('theoretical', 'practical', 'credit'));

ALTER TABLE public.curriculum_template_items 
ADD CONSTRAINT curriculum_template_items_lesson_type_check 
CHECK (lesson_type IN ('theoretical', 'practical', 'credit'));

-- 4. Update default value
ALTER TABLE public.timetable_entries 
ALTER COLUMN lesson_type SET DEFAULT 'theoretical';

ALTER TABLE public.curriculum_template_items 
ALTER COLUMN lesson_type SET DEFAULT 'theoretical';
