-- Align migration: ensure subject_grades has subject_id (nullable) for future joins

ALTER TABLE public.subject_grades
  ADD COLUMN IF NOT EXISTS subject_id uuid REFERENCES public.subjects(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_subject_grades_subject_id ON public.subject_grades(subject_id);
