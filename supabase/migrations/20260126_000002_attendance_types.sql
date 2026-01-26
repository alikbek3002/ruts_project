-- Add attendance_type field for Kyrgyz attendance marks
-- Types: present, absent, duty (Кезмет), excused (Арыз), sick (Оруу)

-- Add attendance_type column
ALTER TABLE public.lesson_journal 
ADD COLUMN IF NOT EXISTS attendance_type text null;

-- Create check constraint for valid attendance types
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'lesson_journal_attendance_type_check'
    ) THEN
        ALTER TABLE public.lesson_journal 
        ADD CONSTRAINT lesson_journal_attendance_type_check 
        CHECK (attendance_type IS NULL OR attendance_type IN ('present', 'absent', 'duty', 'excused', 'sick'));
    END IF;
END$$;

-- Update grade constraint to allow 2-5 (remove 1)
-- First drop existing constraint if exists
DO $$
BEGIN
    -- Drop old constraint if exists
    ALTER TABLE public.lesson_journal DROP CONSTRAINT IF EXISTS lesson_journal_grade_check;
EXCEPTION
    WHEN undefined_object THEN
        NULL;
END$$;

-- Add new constraint for grades 2-5
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'lesson_journal_grade_check_2_5'
    ) THEN
        ALTER TABLE public.lesson_journal 
        ADD CONSTRAINT lesson_journal_grade_check_2_5 
        CHECK (grade IS NULL OR (grade >= 2 AND grade <= 5));
    END IF;
END$$;

-- Create index on attendance_type for filtering
CREATE INDEX IF NOT EXISTS idx_lesson_journal_attendance_type ON public.lesson_journal(attendance_type);

-- Add comments for documentation
COMMENT ON COLUMN public.lesson_journal.attendance_type IS 'Attendance type: present, absent, duty (Кезмет), excused (Арыз), sick (Оруу)';
