-- Migration: Auto-scheduling system with constraints
-- Created: 2025-12-30
-- Description: Add tables and logic for automatic timetable generation
-- Requirements:
--   - 3 lesson types: theoretical, practical, credit
--   - 1 theory + 1 practice per week maximum (theory must come before practice)
--   - No gaps in daily schedule
--   - Hard constraints: no conflicts for teacher/room/class
--   - Soft constraints: balanced load, no more than 3-4 lessons per day

-- ============================================================================
-- 1. SCHEDULE GENERATION CONSTRAINTS TABLE
-- ============================================================================
-- Stores constraints for auto-scheduling
CREATE TABLE public.schedule_constraints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stream_id uuid REFERENCES public.streams(id) ON DELETE CASCADE,
  class_id uuid REFERENCES public.classes(id) ON DELETE CASCADE,
  
  -- Daily constraints
  max_lessons_per_day smallint NOT NULL DEFAULT 4 CHECK (max_lessons_per_day BETWEEN 1 AND 8),
  min_lessons_per_day smallint NOT NULL DEFAULT 3 CHECK (min_lessons_per_day BETWEEN 1 AND 8),
  allow_gaps boolean NOT NULL DEFAULT false, -- Разрешить окна в расписании
  
  -- Weekly constraints
  working_days smallint[] NOT NULL DEFAULT ARRAY[1,2,3,4,5], -- 1=Mon, 2=Tue, ..., 7=Sun
  
  -- Time slots
  earliest_start_time time NOT NULL DEFAULT '09:00',
  latest_end_time time NOT NULL DEFAULT '18:00',
  lesson_duration_minutes smallint NOT NULL DEFAULT 90 CHECK (lesson_duration_minutes > 0),
  break_duration_minutes smallint NOT NULL DEFAULT 15 CHECK (break_duration_minutes >= 0),
  
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  
  CONSTRAINT valid_daily_range CHECK (min_lessons_per_day <= max_lessons_per_day),
  CONSTRAINT valid_time_range CHECK (latest_end_time > earliest_start_time),
  CONSTRAINT has_target CHECK (stream_id IS NOT NULL OR class_id IS NOT NULL)
);

CREATE INDEX idx_schedule_constraints_stream ON public.schedule_constraints(stream_id);
CREATE INDEX idx_schedule_constraints_class ON public.schedule_constraints(class_id);

COMMENT ON TABLE public.schedule_constraints IS 'Configuration for automatic schedule generation';
COMMENT ON COLUMN public.schedule_constraints.allow_gaps IS 'If false, schedule will have no gaps between lessons';
COMMENT ON COLUMN public.schedule_constraints.working_days IS 'Array of weekday numbers (1-7) when lessons can be scheduled';

-- ============================================================================
-- 2. SUBJECT LESSON PLAN TABLE
-- ============================================================================
-- Defines how many theory/practice lessons per subject per stream
CREATE TABLE public.subject_lesson_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stream_id uuid NOT NULL REFERENCES public.streams(id) ON DELETE CASCADE,
  subject_id uuid NOT NULL REFERENCES public.subjects(id) ON DELETE CASCADE,
  
  -- Lesson counts
  theoretical_lessons_count smallint NOT NULL DEFAULT 0 CHECK (theoretical_lessons_count >= 0),
  practical_lessons_count smallint NOT NULL DEFAULT 0 CHECK (practical_lessons_count >= 0),
  
  -- Rules
  theory_before_practice boolean NOT NULL DEFAULT true, -- Теория должна идти раньше практики
  max_per_week smallint NOT NULL DEFAULT 2 CHECK (max_per_week BETWEEN 0 AND 7),
  
  -- Teacher assignment
  preferred_teacher_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  
  CONSTRAINT has_lessons CHECK (theoretical_lessons_count > 0 OR practical_lessons_count > 0),
  UNIQUE (stream_id, subject_id)
);

CREATE INDEX idx_subject_lesson_plans_stream ON public.subject_lesson_plans(stream_id);
CREATE INDEX idx_subject_lesson_plans_subject ON public.subject_lesson_plans(subject_id);
CREATE INDEX idx_subject_lesson_plans_teacher ON public.subject_lesson_plans(preferred_teacher_id);

COMMENT ON TABLE public.subject_lesson_plans IS 'Defines lesson distribution for each subject in stream';
COMMENT ON COLUMN public.subject_lesson_plans.max_per_week IS 'Maximum lessons of this subject per week (e.g., 1 theory + 1 practice = 2)';

-- ============================================================================
-- 3. SCHEDULE GENERATION LOGS TABLE
-- ============================================================================
-- Track auto-generation attempts and results
CREATE TABLE public.schedule_generation_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stream_id uuid REFERENCES public.streams(id) ON DELETE CASCADE,
  class_id uuid REFERENCES public.classes(id) ON DELETE CASCADE,
  
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz NULL,
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'success', 'failed', 'partial')),
  
  -- Statistics
  total_lessons_planned integer NULL,
  lessons_scheduled integer NULL,
  conflicts_found integer NULL DEFAULT 0,
  
  -- Error details
  error_message text NULL,
  failed_subjects text[] NULL, -- Subjects that couldn't be scheduled
  
  -- Configuration snapshot
  config jsonb NULL,
  
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL
);

CREATE INDEX idx_schedule_generation_logs_stream ON public.schedule_generation_logs(stream_id);
CREATE INDEX idx_schedule_generation_logs_status ON public.schedule_generation_logs(status);
CREATE INDEX idx_schedule_generation_logs_created ON public.schedule_generation_logs(started_at DESC);

COMMENT ON TABLE public.schedule_generation_logs IS 'Audit log for schedule generation attempts';

-- ============================================================================
-- 4. HELPER FUNCTION: Check teacher availability
-- ============================================================================
CREATE OR REPLACE FUNCTION public.is_teacher_available(
  p_teacher_id uuid,
  p_weekday integer,
  p_start_time time,
  p_end_time time,
  p_exclude_entry_id uuid DEFAULT NULL
) RETURNS boolean AS $$
BEGIN
  RETURN NOT EXISTS (
    SELECT 1 FROM public.timetable_entries
    WHERE teacher_id = p_teacher_id
      AND weekday = p_weekday
      AND active = true
      AND (id IS DISTINCT FROM p_exclude_entry_id)
      AND (
        (start_time, end_time) OVERLAPS (p_start_time, p_end_time)
      )
  );
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION public.is_teacher_available IS 'Check if teacher is free at given time slot';

-- ============================================================================
-- 5. HELPER FUNCTION: Check room availability
-- ============================================================================
CREATE OR REPLACE FUNCTION public.is_room_available(
  p_room text,
  p_weekday integer,
  p_start_time time,
  p_end_time time,
  p_exclude_entry_id uuid DEFAULT NULL
) RETURNS boolean AS $$
BEGIN
  IF p_room IS NULL OR p_room = '' THEN
    RETURN true; -- No room constraint
  END IF;
  
  RETURN NOT EXISTS (
    SELECT 1 FROM public.timetable_entries
    WHERE room = p_room
      AND weekday = p_weekday
      AND active = true
      AND (id IS DISTINCT FROM p_exclude_entry_id)
      AND (
        (start_time, end_time) OVERLAPS (p_start_time, p_end_time)
      )
  );
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION public.is_room_available IS 'Check if room is free at given time slot';

-- ============================================================================
-- 6. HELPER FUNCTION: Check class availability
-- ============================================================================
CREATE OR REPLACE FUNCTION public.is_class_available(
  p_class_id uuid,
  p_weekday integer,
  p_start_time time,
  p_end_time time,
  p_exclude_entry_id uuid DEFAULT NULL
) RETURNS boolean AS $$
BEGIN
  RETURN NOT EXISTS (
    SELECT 1 FROM public.timetable_entries
    WHERE class_id = p_class_id
      AND weekday = p_weekday
      AND active = true
      AND (id IS DISTINCT FROM p_exclude_entry_id)
      AND (
        (start_time, end_time) OVERLAPS (p_start_time, p_end_time)
      )
  );
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION public.is_class_available IS 'Check if class is free at given time slot';

-- ============================================================================
-- 7. HELPER FUNCTION: Get available time slots for class on given day
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_available_slots_for_class(
  p_class_id uuid,
  p_weekday integer,
  p_lesson_duration_minutes integer DEFAULT 90,
  p_break_duration_minutes integer DEFAULT 15,
  p_earliest_start time DEFAULT '09:00',
  p_latest_end time DEFAULT '18:00'
) RETURNS TABLE (
  slot_start time,
  slot_end time
) AS $$
DECLARE
  v_current_time time;
  v_slot_end time;
  v_available boolean;
BEGIN
  v_current_time := p_earliest_start;
  
  WHILE v_current_time + (p_lesson_duration_minutes || ' minutes')::interval <= p_latest_end LOOP
    v_slot_end := v_current_time + (p_lesson_duration_minutes || ' minutes')::interval;
    
    -- Check if slot is available
    v_available := public.is_class_available(p_class_id, p_weekday, v_current_time, v_slot_end);
    
    IF v_available THEN
      slot_start := v_current_time;
      slot_end := v_slot_end;
      RETURN NEXT;
    END IF;
    
    -- Move to next slot (lesson + break)
    v_current_time := v_current_time + ((p_lesson_duration_minutes + p_break_duration_minutes) || ' minutes')::interval;
  END LOOP;
  
  RETURN;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION public.get_available_slots_for_class IS 'Get all available time slots for a class on given day';

-- ============================================================================
-- 8. VIEW: Current week schedule statistics
-- ============================================================================
CREATE OR REPLACE VIEW public.schedule_statistics AS
SELECT 
  c.id as class_id,
  c.name as class_name,
  te.weekday,
  COUNT(*) as lessons_count,
  MIN(te.start_time) as earliest_lesson,
  MAX(te.end_time) as latest_lesson,
  -- Check for gaps
  CASE 
    WHEN COUNT(*) > 1 AND 
         (MAX(te.end_time) - MIN(te.start_time)) > 
         (COUNT(*) * interval '90 minutes' + (COUNT(*) - 1) * interval '15 minutes')
    THEN true 
    ELSE false 
  END as has_gaps
FROM public.classes c
LEFT JOIN public.timetable_entries te ON te.class_id = c.id AND te.active = true
WHERE c.active = true
GROUP BY c.id, c.name, te.weekday
ORDER BY c.name, te.weekday;

COMMENT ON VIEW public.schedule_statistics IS 'Daily statistics for each class schedule';

-- ============================================================================
-- 9. FUNCTION: Validate schedule constraints
-- ============================================================================
CREATE OR REPLACE FUNCTION public.validate_schedule_constraints(
  p_class_id uuid,
  p_weekday integer DEFAULT NULL
) RETURNS TABLE (
  constraint_type text,
  violated boolean,
  message text
) AS $$
BEGIN
  -- Check: No overlapping lessons for same class
  RETURN QUERY
  SELECT 
    'no_class_overlap'::text,
    EXISTS (
      SELECT 1 
      FROM public.timetable_entries t1
      JOIN public.timetable_entries t2 ON t1.class_id = t2.class_id 
        AND t1.weekday = t2.weekday 
        AND t1.id != t2.id
        AND (t1.start_time, t1.end_time) OVERLAPS (t2.start_time, t2.end_time)
      WHERE t1.class_id = p_class_id 
        AND t1.active = true 
        AND t2.active = true
        AND (p_weekday IS NULL OR t1.weekday = p_weekday)
    ),
    'Class has overlapping lessons'::text;
  
  -- Check: No overlapping lessons for same teacher
  RETURN QUERY
  SELECT 
    'no_teacher_overlap'::text,
    EXISTS (
      SELECT 1 
      FROM public.timetable_entries t1
      JOIN public.timetable_entries t2 ON t1.teacher_id = t2.teacher_id 
        AND t1.weekday = t2.weekday 
        AND t1.id != t2.id
        AND (t1.start_time, t1.end_time) OVERLAPS (t2.start_time, t2.end_time)
      WHERE t1.class_id = p_class_id 
        AND t1.active = true 
        AND t2.active = true
        AND t1.teacher_id IS NOT NULL
        AND (p_weekday IS NULL OR t1.weekday = p_weekday)
    ),
    'Teacher has overlapping lessons'::text;
  
  -- Check: Theory before practice for each subject
  RETURN QUERY
  SELECT 
    'theory_before_practice'::text,
    EXISTS (
      WITH subject_lessons AS (
        SELECT 
          subject_id,
          weekday,
          start_time,
          lesson_type,
          ROW_NUMBER() OVER (PARTITION BY subject_id ORDER BY weekday, start_time) as lesson_order
        FROM public.timetable_entries
        WHERE class_id = p_class_id 
          AND active = true
          AND lesson_type IN ('theoretical', 'practical')
          AND (p_weekday IS NULL OR weekday = p_weekday)
      )
      SELECT 1 
      FROM subject_lessons
      WHERE lesson_type = 'practical'
        AND NOT EXISTS (
          SELECT 1 FROM subject_lessons sl2 
          WHERE sl2.subject_id = subject_lessons.subject_id 
            AND sl2.lesson_type = 'theoretical'
            AND sl2.lesson_order < subject_lessons.lesson_order
        )
    ),
    'Practice lesson found before theory lesson for same subject'::text;
  
  RETURN;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION public.validate_schedule_constraints IS 'Validate hard constraints for class schedule';

-- ============================================================================
-- 10. Enable RLS
-- ============================================================================
ALTER TABLE public.schedule_constraints ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subject_lesson_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.schedule_generation_logs ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to read
CREATE POLICY "Allow authenticated read schedule_constraints"
  ON public.schedule_constraints FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "Allow authenticated read subject_lesson_plans"
  ON public.subject_lesson_plans FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "Allow authenticated read schedule_generation_logs"
  ON public.schedule_generation_logs FOR SELECT
  TO authenticated USING (true);

-- Allow admin/manager to write
CREATE POLICY "Allow admin write schedule_constraints"
  ON public.schedule_constraints FOR ALL
  TO authenticated 
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role IN ('admin', 'manager')
    )
  );

CREATE POLICY "Allow admin write subject_lesson_plans"
  ON public.subject_lesson_plans FOR ALL
  TO authenticated 
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role IN ('admin', 'manager')
    )
  );

CREATE POLICY "Allow admin write schedule_generation_logs"
  ON public.schedule_generation_logs FOR ALL
  TO authenticated 
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role IN ('admin', 'manager')
    )
  );

-- ============================================================================
-- 11. Insert default constraints
-- ============================================================================
-- This will be applied per-stream or per-class by admin
-- Example data (commented out, to be set by admin):
-- INSERT INTO public.schedule_constraints (stream_id, max_lessons_per_day, min_lessons_per_day, allow_gaps)
-- SELECT id, 4, 3, false FROM public.streams WHERE status = 'active';

COMMENT ON SCHEMA public IS 'Auto-scheduling system ready. Use schedule_constraints and subject_lesson_plans to configure, then call generation API endpoint.';
