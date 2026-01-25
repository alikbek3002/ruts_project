-- Meeting links for Google Meet (simple URL storage)
-- Replaces complex Zoom OAuth integration with simple link storage

-- Таблица для хранения ссылок на конференции
CREATE TABLE IF NOT EXISTS public.meeting_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Можно привязать к записи расписания
  timetable_entry_id uuid REFERENCES public.timetable_entries(id) ON DELETE CASCADE,
  -- Или к группе напрямую
  class_id uuid REFERENCES public.classes(id) ON DELETE CASCADE,
  -- Или к потоку (для конференций на весь поток)
  stream_id uuid REFERENCES public.streams(id) ON DELETE CASCADE,
  -- Ссылка на Google Meet
  meet_url text NOT NULL,
  -- Название конференции
  title text,
  -- Кто создал
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  -- Дата/время начала (опционально)
  starts_at timestamptz,
  -- Дата создания
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Индексы для быстрого поиска
CREATE INDEX IF NOT EXISTS idx_meeting_links_timetable ON public.meeting_links(timetable_entry_id);
CREATE INDEX IF NOT EXISTS idx_meeting_links_class ON public.meeting_links(class_id);
CREATE INDEX IF NOT EXISTS idx_meeting_links_stream ON public.meeting_links(stream_id);
CREATE INDEX IF NOT EXISTS idx_meeting_links_starts ON public.meeting_links(starts_at);

-- Добавляем колонку meet_url прямо в timetable_entries для удобства
ALTER TABLE public.timetable_entries ADD COLUMN IF NOT EXISTS meet_url text;
