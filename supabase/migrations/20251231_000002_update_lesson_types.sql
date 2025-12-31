ALTER TABLE public.timetable_entries
DROP CONSTRAINT IF EXISTS timetable_entries_lesson_type_check;

ALTER TABLE public.timetable_entries
ADD CONSTRAINT timetable_entries_lesson_type_check 
CHECK (lesson_type IN ('theoretical', 'practical', 'credit', 'lecture'));

-- Update existing 'lecture' to 'theoretical' if needed, or keep 'lecture' as legacy but prefer 'theoretical'
-- The user asked to remove "regular" (which was mapped to 'lecture' in UI) and add 'theoretical' and 'practical'.
-- Let's migrate 'lecture' to 'theoretical' to be safe, or just allow both for now.
-- Actually, the user said "remove regular". In the code it was "lecture".
-- I will map 'lecture' -> 'theoretical' for existing data to avoid breaking things, or just allow new types.

UPDATE public.timetable_entries SET lesson_type = 'theoretical' WHERE lesson_type = 'lecture';
