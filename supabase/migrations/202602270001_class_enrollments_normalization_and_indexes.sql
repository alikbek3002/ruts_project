-- Normalize class_enrollments shape and add performance indexes
-- Safe to run on mixed legacy/new schemas.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'class_enrollments'
  ) THEN
    ALTER TABLE public.class_enrollments
      ADD COLUMN IF NOT EXISTS id uuid,
      ADD COLUMN IF NOT EXISTS legacy_student_id uuid,
      ADD COLUMN IF NOT EXISTS student_full_name text,
      ADD COLUMN IF NOT EXISTS student_number integer;

    UPDATE public.class_enrollments
    SET id = gen_random_uuid()
    WHERE id IS NULL;

    ALTER TABLE public.class_enrollments
      ALTER COLUMN id SET DEFAULT gen_random_uuid();

    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name='class_enrollments' AND column_name='student_id'
    ) THEN
      UPDATE public.class_enrollments
      SET legacy_student_id = student_id
      WHERE legacy_student_id IS NULL AND student_id IS NOT NULL;
    END IF;

    UPDATE public.class_enrollments ce
    SET student_full_name = u.full_name
    FROM public.users u
    WHERE ce.student_full_name IS NULL
      AND ce.legacy_student_id = u.id;

    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name='class_enrollments' AND column_name='student_id'
    ) THEN
      UPDATE public.class_enrollments ce
      SET student_full_name = u.full_name
      FROM public.users u
      WHERE ce.student_full_name IS NULL
        AND ce.student_id = u.id;
    END IF;

    CREATE UNIQUE INDEX IF NOT EXISTS uq_class_enrollments_id
      ON public.class_enrollments(id);

    CREATE INDEX IF NOT EXISTS idx_class_enrollments_class_legacy
      ON public.class_enrollments(class_id, legacy_student_id);
  END IF;
END
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema='public' AND table_name='lesson_journal'
  ) THEN
    CREATE INDEX IF NOT EXISTS idx_lesson_journal_entry_date_student
      ON public.lesson_journal(timetable_entry_id, lesson_date, student_id);
  END IF;
END
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema='public' AND table_name='timetable_entries'
  ) THEN
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name='timetable_entries' AND column_name='class_id'
    ) THEN
      CREATE INDEX IF NOT EXISTS idx_timetable_entries_class_subject_teacher
        ON public.timetable_entries(class_id, subject_id, teacher_id);
    END IF;

    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name='timetable_entries' AND column_name='class_ids'
    ) THEN
      CREATE INDEX IF NOT EXISTS idx_timetable_entries_class_ids_gin
        ON public.timetable_entries USING GIN (class_ids);
    END IF;

    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name='timetable_entries' AND column_name='subject_id'
    ) THEN
      CREATE INDEX IF NOT EXISTS idx_timetable_entries_subject_teacher
        ON public.timetable_entries(subject_id, teacher_id);
    END IF;
  END IF;
END
$$;
