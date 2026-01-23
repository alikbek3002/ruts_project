-- Migration: Update lesson types in timetable_entries and curriculum_plan
-- Date: 2026-01-23

-- 1. Update timetable_entries
-- Rename 'credit' to 'exam' and 'practical' to 'exam' (if any practicals were used as exams/credits)
UPDATE timetable_entries
SET lesson_type = 'exam'
WHERE lesson_type IN ('credit', 'practical', 'zachet'); -- covering potential variations

-- 2. Update curriculum_plan if needed (though previous migration 20260122_000002_curriculum_plan_hours.sql 
-- already handled the column structure change from booleans to float hours.
-- We just ensure consistency in any text fields if they exist, but lesson_type is mainly in timetable_entries.)

-- 3. Add comment
COMMENT ON COLUMN timetable_entries.lesson_type IS 'Type of lesson: lecture, seminar, exam';
