-- Направления (отделы)
CREATE TABLE IF NOT EXISTS public.directions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  code text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Вставляем 4 направления
INSERT INTO public.directions (name, code) VALUES
  ('Отдел охрана', 'OKHRANA'),
  ('Патрульно-постовая служба (ППС)', 'PPS'),
  ('Управление патрульной службы милиции (УПСМ)', 'UPSM'),
  ('Полк специального назначения (ПСН)', 'PSN')
ON CONFLICT (code) DO NOTHING;

-- Добавляем direction_id в classes
ALTER TABLE public.classes ADD COLUMN IF NOT EXISTS direction_id uuid REFERENCES public.directions(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_classes_direction ON public.classes(direction_id);

-- Тип пары: lecture (обычная) или credit (зачет)
-- При типе credit оценки будут: pass (зачет) / fail (незачет)
ALTER TABLE public.timetable_entries ADD COLUMN IF NOT EXISTS lesson_type text NOT NULL DEFAULT 'lecture' CHECK (lesson_type IN ('lecture', 'credit'));

-- Создаем индекс для lesson_type
CREATE INDEX IF NOT EXISTS idx_timetable_entries_lesson_type ON public.timetable_entries(lesson_type);
