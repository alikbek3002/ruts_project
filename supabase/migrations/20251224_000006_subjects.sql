-- Subjects: статичные предметы
CREATE TABLE IF NOT EXISTS public.subjects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Teacher subjects: связь учителей с предметами (до 2 предметов)
CREATE TABLE IF NOT EXISTS public.teacher_subjects (
  teacher_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  subject_id uuid NOT NULL REFERENCES public.subjects(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (teacher_id, subject_id)
);

-- Добавляем subject_id в timetable_entries
ALTER TABLE public.timetable_entries ADD COLUMN IF NOT EXISTS subject_id uuid REFERENCES public.subjects(id) ON DELETE SET NULL;

-- Создаем индексы
CREATE INDEX IF NOT EXISTS idx_teacher_subjects_teacher ON public.teacher_subjects(teacher_id);
CREATE INDEX IF NOT EXISTS idx_teacher_subjects_subject ON public.teacher_subjects(subject_id);
CREATE INDEX IF NOT EXISTS idx_timetable_entries_subject ON public.timetable_entries(subject_id);

-- Изменяем subject_grades чтобы использовать subject_id
ALTER TABLE public.subject_grades ADD COLUMN IF NOT EXISTS subject_id uuid REFERENCES public.subjects(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_subject_grades_subject_id ON public.subject_grades(subject_id);
