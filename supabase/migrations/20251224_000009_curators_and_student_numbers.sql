-- Curator (homeroom teacher) + student numbering in classes

-- 1) Curator on classes
ALTER TABLE public.classes
  ADD COLUMN IF NOT EXISTS curator_id uuid NULL REFERENCES public.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_classes_curator_id ON public.classes(curator_id);

-- 2) Student number inside class (1..35)
ALTER TABLE public.class_enrollments
  ADD COLUMN IF NOT EXISTS student_number integer NULL;

-- Backfill numbers for existing enrollments (by created_at)
WITH ranked AS (
  SELECT
    class_id,
    student_id,
    row_number() OVER (PARTITION BY class_id ORDER BY created_at, student_id) AS rn
  FROM public.class_enrollments
  WHERE student_number IS NULL
)
UPDATE public.class_enrollments ce
SET student_number = ranked.rn
FROM ranked
WHERE ce.class_id = ranked.class_id
  AND ce.student_id = ranked.student_id;

-- Enforce numbering rules for new/updated rows (existing rows are not validated)
ALTER TABLE public.class_enrollments
  ADD CONSTRAINT IF NOT EXISTS chk_class_enrollments_student_number_range
  CHECK (student_number IS NULL OR (student_number >= 1 AND student_number <= 35)) NOT VALID;

CREATE UNIQUE INDEX IF NOT EXISTS uq_class_enrollments_student_number
  ON public.class_enrollments(class_id, student_number)
  WHERE student_number IS NOT NULL;
