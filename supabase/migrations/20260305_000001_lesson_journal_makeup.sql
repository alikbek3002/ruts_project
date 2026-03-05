-- Add makeup fields to lesson_journal:
-- 1) makeup_grade for grade rework (e.g. 2/5)
-- 2) attendance_makeup for absence rework (e.g. NB/OTR)

ALTER TABLE public.lesson_journal
ADD COLUMN IF NOT EXISTS makeup_grade smallint NULL;

ALTER TABLE public.lesson_journal
ADD COLUMN IF NOT EXISTS attendance_makeup boolean NULL;

UPDATE public.lesson_journal
SET attendance_makeup = false
WHERE attendance_makeup IS NULL;

ALTER TABLE public.lesson_journal
ALTER COLUMN attendance_makeup SET DEFAULT false;

ALTER TABLE public.lesson_journal
ALTER COLUMN attendance_makeup SET NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'lesson_journal_makeup_grade_check_2_5'
    ) THEN
        ALTER TABLE public.lesson_journal
        ADD CONSTRAINT lesson_journal_makeup_grade_check_2_5
        CHECK (makeup_grade IS NULL OR (makeup_grade >= 2 AND makeup_grade <= 5));
    END IF;
END$$;

COMMENT ON COLUMN public.lesson_journal.makeup_grade IS 'Makeup grade after rework; original grade remains in grade column';
COMMENT ON COLUMN public.lesson_journal.attendance_makeup IS 'True if absence was worked off (OTR)';
