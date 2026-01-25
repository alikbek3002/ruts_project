-- Cycles system for subject categorization
-- Циклы: А, БФП, У, ЖУТ

-- Таблица циклов
CREATE TABLE IF NOT EXISTS public.cycles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,  -- 'A', 'BFP', 'U', 'ZUT'
  name text NOT NULL,
  description text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Seed данные для 4 циклов
INSERT INTO public.cycles (code, name, description) VALUES 
  ('A', 'Цикл А', 'Цикл А'),
  ('BFP', 'Цикл БФП', 'Цикл БФП (Боевая и физическая подготовка)'),
  ('U', 'Цикл У', 'Цикл У'),
  ('ZUT', 'Цикл ЖУТ', 'Цикл ЖУТ')
ON CONFLICT (code) DO NOTHING;

-- Добавляем cycle_id в subjects для привязки предметов к циклам
ALTER TABLE public.subjects ADD COLUMN IF NOT EXISTS cycle_id uuid REFERENCES public.cycles(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_subjects_cycle_id ON public.subjects(cycle_id);

-- Таблица связи учителей с циклами (многие-ко-многим)
CREATE TABLE IF NOT EXISTS public.teacher_cycles (
  teacher_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  cycle_id uuid NOT NULL REFERENCES public.cycles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (teacher_id, cycle_id)
);

CREATE INDEX IF NOT EXISTS idx_teacher_cycles_teacher ON public.teacher_cycles(teacher_id);
CREATE INDEX IF NOT EXISTS idx_teacher_cycles_cycle ON public.teacher_cycles(cycle_id);
