-- Migration: Streams System for 3-month cohorts with auto-scheduling
-- Created: 2025-12-29
-- Description: Add streams (потоки) tables, curriculum templates, and enhance timetable for auto-scheduling

-- ============================================================================
-- 1. STREAMS TABLE
-- ============================================================================
-- Represents a 3-month cohort of multiple classes
CREATE TABLE public.streams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  start_date date NOT NULL,
  end_date date NOT NULL,
  direction_id uuid REFERENCES public.directions(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'completed', 'archived')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT valid_date_range CHECK (end_date > start_date),
  CONSTRAINT three_month_duration CHECK (end_date <= start_date + INTERVAL '100 days')
);

CREATE INDEX idx_streams_status ON public.streams(status);
CREATE INDEX idx_streams_dates ON public.streams(start_date, end_date);
CREATE INDEX idx_streams_direction ON public.streams(direction_id);

COMMENT ON TABLE public.streams IS 'Educational streams (потоки) - 3-month cohorts of classes';
COMMENT ON COLUMN public.streams.status IS 'draft: being prepared, active: currently running, completed: finished, archived: old data';
COMMENT ON CONSTRAINT three_month_duration ON public.streams IS 'Streams should be approximately 3 months (90 days, allowing 100 for flexibility)';

-- ============================================================================
-- 2. STREAM_CLASSES JUNCTION TABLE
-- ============================================================================
-- Links classes to streams (many-to-many)
CREATE TABLE public.stream_classes (
  stream_id uuid NOT NULL REFERENCES public.streams(id) ON DELETE CASCADE,
  class_id uuid NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
  added_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (stream_id, class_id)
);

CREATE INDEX idx_stream_classes_stream ON public.stream_classes(stream_id);
CREATE INDEX idx_stream_classes_class ON public.stream_classes(class_id);

COMMENT ON TABLE public.stream_classes IS 'Junction table: which classes belong to which streams';

-- ============================================================================
-- 3. CURRICULUM TEMPLATES TABLE
-- ============================================================================
-- Defines standard curriculum: how many hours per week for each subject
CREATE TABLE public.curriculum_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  description text NULL,
  direction_id uuid REFERENCES public.directions(id) ON DELETE SET NULL,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_curriculum_templates_direction ON public.curriculum_templates(direction_id);
CREATE INDEX idx_curriculum_templates_default ON public.curriculum_templates(is_default) WHERE is_default = true;

COMMENT ON TABLE public.curriculum_templates IS 'Curriculum templates defining subject hours distribution';

-- ============================================================================
-- 4. CURRICULUM TEMPLATE ITEMS
-- ============================================================================
-- Individual subjects within a curriculum template
CREATE TABLE public.curriculum_template_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL REFERENCES public.curriculum_templates(id) ON DELETE CASCADE,
  subject_id uuid NOT NULL REFERENCES public.subjects(id) ON DELETE CASCADE,
  hours_per_week numeric(4,2) NOT NULL CHECK (hours_per_week > 0 AND hours_per_week <= 40),
  lesson_type text NOT NULL DEFAULT 'lecture' CHECK (lesson_type IN ('lecture', 'credit')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (template_id, subject_id, lesson_type)
);

CREATE INDEX idx_curriculum_items_template ON public.curriculum_template_items(template_id);
CREATE INDEX idx_curriculum_items_subject ON public.curriculum_template_items(subject_id);

COMMENT ON TABLE public.curriculum_template_items IS 'Subject hours allocation within curriculum templates';
COMMENT ON COLUMN public.curriculum_template_items.hours_per_week IS 'Academic hours per week (1.5 hour lesson = 1.5 hours)';

-- ============================================================================
-- 5. ENHANCE TIMETABLE_ENTRIES TABLE
-- ============================================================================
-- Add stream_id and metadata for auto-scheduling

-- Add stream_id column
ALTER TABLE public.timetable_entries 
  ADD COLUMN stream_id uuid REFERENCES public.streams(id) ON DELETE CASCADE;

-- Add duration_minutes computed/stored column
ALTER TABLE public.timetable_entries
  ADD COLUMN duration_minutes smallint GENERATED ALWAYS AS (
    EXTRACT(EPOCH FROM (end_time - start_time)) / 60
  ) STORED;

-- Add classes array for multi-class lessons (2-4 vzvodы on same lesson)
ALTER TABLE public.timetable_entries
  ADD COLUMN class_ids uuid[] NULL;

-- Add notes for manual edits
ALTER TABLE public.timetable_entries
  ADD COLUMN notes text NULL;

-- Add auto-generated flag
ALTER TABLE public.timetable_entries
  ADD COLUMN auto_generated boolean NOT NULL DEFAULT false;

-- Create indexes for scheduling queries
CREATE INDEX idx_timetable_entries_stream ON public.timetable_entries(stream_id);
CREATE INDEX idx_timetable_entries_weekday_time ON public.timetable_entries(weekday, start_time, end_time);
CREATE INDEX idx_timetable_entries_teacher_weekday ON public.timetable_entries(teacher_id, weekday, start_time) WHERE teacher_id IS NOT NULL;
CREATE INDEX idx_timetable_entries_room_weekday ON public.timetable_entries(room, weekday, start_time) WHERE room IS NOT NULL;
CREATE INDEX idx_timetable_entries_auto_generated ON public.timetable_entries(auto_generated) WHERE auto_generated = true;

COMMENT ON COLUMN public.timetable_entries.stream_id IS 'Which stream this timetable entry belongs to (for bulk operations)';
COMMENT ON COLUMN public.timetable_entries.duration_minutes IS 'Lesson duration in minutes (auto-calculated)';
COMMENT ON COLUMN public.timetable_entries.class_ids IS 'Array of class UUIDs when multiple vzvodы attend same lesson';
COMMENT ON COLUMN public.timetable_entries.auto_generated IS 'True if created by auto-scheduler, false if manually created/edited';

-- ============================================================================
-- 6. TEACHER WORKLOAD VIEW
-- ============================================================================
-- Computed view for teacher hours calculation
-- Note: A lesson counts as 1 occurrence for teacher regardless of how many classes attend

CREATE OR REPLACE VIEW public.teacher_workload_weekly AS
SELECT 
  te.teacher_id,
  te.stream_id,
  COUNT(DISTINCT (te.weekday, te.start_time, te.end_time)) as lessons_per_week,
  SUM(DISTINCT te.duration_minutes) / 60.0 as hours_per_week,
  SUM(DISTINCT te.duration_minutes) / 45.0 as academic_hours_per_week
FROM public.timetable_entries te
WHERE te.active = true 
  AND te.teacher_id IS NOT NULL
GROUP BY te.teacher_id, te.stream_id;

COMMENT ON VIEW public.teacher_workload_weekly IS 'Teacher workload: unique lessons per week (not counting duplicate classes on same lesson)';

-- ============================================================================
-- 7. SCHEDULING CONSTRAINTS TABLE (Optional - for future use)
-- ============================================================================
-- Store scheduling preferences and constraints
CREATE TABLE public.scheduling_constraints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stream_id uuid NOT NULL REFERENCES public.streams(id) ON DELETE CASCADE,
  constraint_type text NOT NULL CHECK (constraint_type IN ('lunch_break', 'no_lesson_time', 'max_lessons_per_day', 'teacher_preference')),
  constraint_data jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_scheduling_constraints_stream ON public.scheduling_constraints(stream_id);
CREATE INDEX idx_scheduling_constraints_type ON public.scheduling_constraints(constraint_type);

COMMENT ON TABLE public.scheduling_constraints IS 'Scheduling constraints like lunch breaks, blackout times, teacher preferences';
COMMENT ON COLUMN public.scheduling_constraints.constraint_data IS 'JSON with constraint details, e.g., {"start_time": "13:20", "end_time": "14:20"} for lunch';

-- ============================================================================
-- 8. DEFAULT LUNCH BREAK CONSTRAINT
-- ============================================================================
-- Insert default lunch break constraint (13:20 - 14:20)
-- Will be applied globally unless overridden

CREATE TABLE public.global_scheduling_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  setting_key text NOT NULL UNIQUE,
  setting_value jsonb NOT NULL,
  description text NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.global_scheduling_settings (setting_key, setting_value, description) VALUES
('lunch_break', '{"start_time": "13:20", "end_time": "14:20"}', 'Daily lunch break - no lessons scheduled'),
('saturday_mode', '{"mode": "subbotnik", "no_lessons": true}', 'Saturdays are for subbotnik (no regular lessons)'),
('time_slots', '[
  {"slot": 1, "start_time": "09:00", "end_time": "10:20"},
  {"slot": 2, "start_time": "10:30", "end_time": "11:50"},
  {"slot": 3, "start_time": "12:00", "end_time": "13:20"},
  {"slot": 4, "start_time": "14:20", "end_time": "15:40"},
  {"slot": 5, "start_time": "15:50", "end_time": "17:10"}
]', 'Standard time slots for lessons'),
('min_classes_per_lesson', '{"min": 2, "max": 4}', 'Multiple vzvodы (2-4) can attend same lesson'),
('academic_year', '{"start_month": 9, "start_day": 1, "end_month": 5, "end_day": 31}', 'Academic year: Sept 1 - May 31');

COMMENT ON TABLE public.global_scheduling_settings IS 'Global settings for auto-scheduler (lunch, time slots, etc.)';

-- ============================================================================
-- 9. UPDATE TRIGGER FOR STREAMS
-- ============================================================================
CREATE OR REPLACE FUNCTION update_streams_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER streams_updated_at_trigger
  BEFORE UPDATE ON public.streams
  FOR EACH ROW
  EXECUTE FUNCTION update_streams_updated_at();

CREATE TRIGGER curriculum_templates_updated_at_trigger
  BEFORE UPDATE ON public.curriculum_templates
  FOR EACH ROW
  EXECUTE FUNCTION update_streams_updated_at();

-- ============================================================================
-- 10. SAMPLE DATA (Optional - can be removed in production)
-- ============================================================================

-- Create default curriculum template
INSERT INTO public.curriculum_templates (name, description, is_default) VALUES
('Стандартный курс (3 месяца)', 'Базовый учебный план на 3 месяца обучения', true);

-- Get the template ID
DO $$
DECLARE
  template_id uuid;
  math_subject_id uuid;
  physics_subject_id uuid;
  law_subject_id uuid;
  tactics_subject_id uuid;
BEGIN
  SELECT id INTO template_id FROM public.curriculum_templates WHERE name = 'Стандартный курс (3 месяца)';
  
  -- Get some subject IDs (assuming they exist from seed data)
  SELECT id INTO math_subject_id FROM public.subjects WHERE name LIKE '%Математика%' LIMIT 1;
  SELECT id INTO physics_subject_id FROM public.subjects WHERE name LIKE '%Физика%' LIMIT 1;
  SELECT id INTO law_subject_id FROM public.subjects WHERE name LIKE '%Право%' LIMIT 1;
  SELECT id INTO tactics_subject_id FROM public.subjects WHERE name LIKE '%Тактика%' LIMIT 1;
  
  -- Insert curriculum items if subjects exist
  IF math_subject_id IS NOT NULL THEN
    INSERT INTO public.curriculum_template_items (template_id, subject_id, hours_per_week, lesson_type) 
    VALUES (template_id, math_subject_id, 4.5, 'lecture');
  END IF;
  
  IF physics_subject_id IS NOT NULL THEN
    INSERT INTO public.curriculum_template_items (template_id, subject_id, hours_per_week, lesson_type) 
    VALUES (template_id, physics_subject_id, 3.0, 'lecture');
  END IF;
  
  IF law_subject_id IS NOT NULL THEN
    INSERT INTO public.curriculum_template_items (template_id, subject_id, hours_per_week, lesson_type) 
    VALUES (template_id, law_subject_id, 3.0, 'lecture');
  END IF;
  
  IF tactics_subject_id IS NOT NULL THEN
    INSERT INTO public.curriculum_template_items (template_id, subject_id, hours_per_week, lesson_type) 
    VALUES (template_id, tactics_subject_id, 6.0, 'lecture');
  END IF;
END $$;

-- ============================================================================
-- MIGRATION COMPLETE
-- ============================================================================
