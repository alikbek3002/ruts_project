-- Add lesson topic and homework fields to lesson_journal
ALTER TABLE lesson_journal
ADD COLUMN IF NOT EXISTS lesson_topic TEXT,
ADD COLUMN IF NOT EXISTS homework TEXT;

-- Add index for better query performance
CREATE INDEX IF NOT EXISTS idx_lesson_journal_timetable_date 
ON lesson_journal(timetable_entry_id, lesson_date);

COMMENT ON COLUMN lesson_journal.lesson_topic IS 'Тема урока';
COMMENT ON COLUMN lesson_journal.homework IS 'Домашнее задание';
