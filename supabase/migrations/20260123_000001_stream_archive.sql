-- Migration: Stream Archive System
-- Created: 2026-01-23
-- Description: Add archive support for educational streams with full statistics

-- ============================================================================
-- 1. ADD ARCHIVED_AT FIELD TO STREAMS
-- ============================================================================
-- Track when a stream was archived
ALTER TABLE public.streams 
  ADD COLUMN IF NOT EXISTS archived_at timestamptz NULL;

CREATE INDEX IF NOT EXISTS idx_streams_archived_at ON public.streams(archived_at) WHERE archived_at IS NOT NULL;

COMMENT ON COLUMN public.streams.archived_at IS 'Timestamp when stream was archived (NULL if not archived)';

-- ============================================================================
-- 2. CREATE VIEW FOR ARCHIVED STREAMS STATISTICS
-- ============================================================================
-- First, let's verify the table structure exists
DO $$
BEGIN
  -- Check if class_enrollments table has legacy_student_id column
  IF NOT EXISTS (
    SELECT 1 
    FROM information_schema.columns 
    WHERE table_schema = 'public' 
      AND table_name = 'class_enrollments' 
      AND column_name = 'legacy_student_id'
  ) THEN
    RAISE EXCEPTION 'Table class_enrollments does not have legacy_student_id column. Please run earlier migrations first.';
  END IF;  
END $$;

-- Drop existing view if it exists (to avoid type conflicts)
DROP VIEW IF EXISTS public.archived_streams_stats CASCADE;

-- Comprehensive statistics for archived streams
CREATE OR REPLACE VIEW public.archived_streams_stats AS
SELECT 
  s.id as stream_id,
  s.name as stream_name,
  s.start_date,
  s.end_date,
  s.archived_at,
  s.direction_id,
  d.name as direction_name,
  
  -- Class statistics
  (SELECT COUNT(DISTINCT sc2.class_id)
   FROM public.stream_classes sc2
   WHERE sc2.stream_id = s.id) as total_classes,
  
  -- Student statistics
  (SELECT COUNT(DISTINCT ce2.legacy_student_id)
   FROM public.stream_classes sc2
   JOIN public.class_enrollments ce2 ON sc2.class_id = ce2.class_id
   WHERE sc2.stream_id = s.id AND ce2.legacy_student_id IS NOT NULL) as total_students,
  
  -- Attendance statistics (from lesson_journal)
  (SELECT ROUND(AVG(CASE WHEN lj2.present = true THEN 100.0 ELSE 0.0 END)::numeric, 2)
   FROM public.timetable_entries te2
   JOIN public.lesson_journal lj2 ON te2.id = lj2.timetable_entry_id
   WHERE te2.stream_id = s.id) as avg_attendance_percentage,
  
  -- Grade statistics (from lesson_journal)
  (SELECT ROUND(AVG(lj2.grade)::numeric, 2)
   FROM public.timetable_entries te2
   JOIN public.lesson_journal lj2 ON te2.id = lj2.timetable_entry_id
   WHERE te2.stream_id = s.id AND lj2.grade IS NOT NULL) as avg_lesson_grade,
   
  (SELECT COUNT(lj2.grade)
   FROM public.timetable_entries te2
   JOIN public.lesson_journal lj2 ON te2.id = lj2.timetable_entry_id
   WHERE te2.stream_id = s.id AND lj2.grade IS NOT NULL) as total_lesson_grades,
  
  -- Subject grade statistics
  (SELECT ROUND(AVG(sg2.grade)::numeric, 2)
   FROM public.stream_classes sc2
   JOIN public.subject_grades sg2 ON sc2.class_id = sg2.class_id
   WHERE sc2.stream_id = s.id AND sg2.grade IS NOT NULL) as avg_subject_grade,
   
  (SELECT COUNT(sg2.grade)
   FROM public.stream_classes sc2
   JOIN public.subject_grades sg2 ON sc2.class_id = sg2.class_id
   WHERE sc2.stream_id = s.id AND sg2.grade IS NOT NULL) as total_subject_grades,
  
  -- Test attempt statistics
  (SELECT COUNT(DISTINCT ta2.id)
   FROM public.stream_classes sc2
   JOIN public.class_enrollments ce2 ON sc2.class_id = ce2.class_id
   JOIN public.test_attempts ta2 ON ce2.legacy_student_id = ta2.student_id
   WHERE sc2.stream_id = s.id AND ce2.legacy_student_id IS NOT NULL) as total_test_attempts,
   
  (SELECT ROUND(AVG(ta2.percentage_score)::numeric, 2)
   FROM public.stream_classes sc2
   JOIN public.class_enrollments ce2 ON sc2.class_id = ce2.class_id
   JOIN public.test_attempts ta2 ON ce2.legacy_student_id = ta2.student_id
   WHERE sc2.stream_id = s.id AND ce2.legacy_student_id IS NOT NULL AND ta2.percentage_score IS NOT NULL) as avg_test_score,
  
  -- Subject test attempt statistics
  (SELECT COUNT(DISTINCT sta2.id)
   FROM public.stream_classes sc2
   JOIN public.class_enrollments ce2 ON sc2.class_id = ce2.class_id
   JOIN public.subject_test_attempts sta2 ON ce2.legacy_student_id = sta2.student_id
   WHERE sc2.stream_id = s.id AND ce2.legacy_student_id IS NOT NULL) as total_subject_test_attempts,
   
  (SELECT ROUND(AVG(sta2.percentage_score)::numeric, 2)
   FROM public.stream_classes sc2
   JOIN public.class_enrollments ce2 ON sc2.class_id = ce2.class_id
   JOIN public.subject_test_attempts sta2 ON ce2.legacy_student_id = sta2.student_id
   WHERE sc2.stream_id = s.id AND ce2.legacy_student_id IS NOT NULL AND sta2.percentage_score IS NOT NULL) as avg_subject_test_score,
  
  -- Timetable entries count
  (SELECT COUNT(DISTINCT te2.id)
   FROM public.timetable_entries te2
   WHERE te2.stream_id = s.id) as total_timetable_entries

FROM public.streams s
LEFT JOIN public.directions d ON s.direction_id = d.id
WHERE s.status = 'archived';

COMMENT ON VIEW public.archived_streams_stats IS 'Comprehensive statistics for archived streams including attendance, grades, and test results';

-- ============================================================================
-- 3. CREATE VIEW FOR STUDENT PERFORMANCE IN ARCHIVED STREAMS
-- ============================================================================
-- Drop existing view if it exists (to avoid type conflicts)
DROP VIEW IF EXISTS public.archived_student_performance CASCADE;

-- Detailed student statistics within archived streams
CREATE OR REPLACE VIEW public.archived_student_performance AS
SELECT 
  s.id as stream_id,
  s.name as stream_name,
  c.id as class_id,
  c.name as class_name,
  u.id as student_id,
  u.full_name as student_name,
  
  -- Attendance
  COUNT(lj.present) as total_lessons,
  COUNT(CASE WHEN lj.present = true THEN 1 END) as lessons_attended,
  ROUND(
    (COUNT(CASE WHEN lj.present = true THEN 1 END)::numeric / 
     NULLIF(COUNT(lj.present), 0) * 100)::numeric,
    2
  ) as attendance_percentage,
  
  -- Lesson grades
  ROUND(AVG(lj.grade)::numeric, 2) as avg_lesson_grade,
  COUNT(lj.grade) as lesson_grades_count,
  
  -- Subject grades
  ROUND(AVG(sg.grade)::numeric, 2) as avg_subject_grade,
  COUNT(sg.grade) as subject_grades_count,
  
  -- Test attempts (course_tests)
  COUNT(ta.id) as test_attempts_count,
  COUNT(CASE WHEN ta.submitted_at IS NOT NULL THEN 1 END) as tests_completed,
  ROUND(AVG(ta.percentage_score)::numeric, 2) as avg_test_score,
  
  -- Subject test attempts
  COUNT(sta.id) as subject_test_attempts_count,
  COUNT(CASE WHEN sta.submitted_at IS NOT NULL THEN 1 END) as subject_tests_completed,
  ROUND(AVG(sta.percentage_score)::numeric, 2) as avg_subject_test_score,
  
  -- Overall performance indicator (student passed or failed)
  CASE 
    WHEN AVG(lj.grade) >= 3 
         AND (COUNT(CASE WHEN lj.present = true THEN 1 END)::numeric / 
              NULLIF(COUNT(lj.present), 0) * 100) >= 70
    THEN true
    ELSE false
  END as passed_course

FROM public.streams s
JOIN public.stream_classes sc ON s.id = sc.stream_id
JOIN public.classes c ON sc.class_id = c.id
JOIN public.class_enrollments ce ON c.id = ce.class_id
JOIN public.users u ON ce.legacy_student_id = u.id
LEFT JOIN public.timetable_entries te ON s.id = te.stream_id AND c.id = te.class_id
LEFT JOIN public.lesson_journal lj ON te.id = lj.timetable_entry_id AND u.id = lj.student_id
LEFT JOIN public.subject_grades sg ON c.id = sg.class_id AND u.id = sg.student_id
LEFT JOIN public.test_attempts ta ON u.id = ta.student_id
LEFT JOIN public.subject_test_attempts sta ON u.id = sta.student_id

WHERE s.status = 'archived' AND ce.legacy_student_id IS NOT NULL

GROUP BY 
  s.id, s.name, c.id, c.name, u.id, u.full_name;

COMMENT ON VIEW public.archived_student_performance IS 'Individual student performance statistics within archived streams';

-- ============================================================================
-- 4. FUNCTION FOR AUTOMATIC ARCHIVING
-- ============================================================================
-- Automatically archive completed streams after 7 days past end_date
CREATE OR REPLACE FUNCTION public.auto_archive_completed_streams()
RETURNS TABLE(
  archived_stream_id uuid,
  archived_stream_name text,
  archived_at timestamptz
) AS $$
BEGIN
  RETURN QUERY
  UPDATE public.streams
  SET 
    status = 'archived',
    archived_at = now(),
    updated_at = now()
  WHERE 
    status = 'completed'
    AND end_date + INTERVAL '7 days' < CURRENT_DATE
    AND archived_at IS NULL
  RETURNING id, name, archived_at;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION public.auto_archive_completed_streams() IS 'Automatically archives completed streams 7 days after their end date';

-- ============================================================================
-- 5. FUNCTION FOR MANUAL ARCHIVING
-- ============================================================================
-- Allow admins to manually archive a stream
CREATE OR REPLACE FUNCTION public.archive_stream(p_stream_id uuid)
RETURNS jsonb AS $$
DECLARE
  v_stream_name text;
  v_stream_status text;
  v_class_count int;
  v_student_count int;
BEGIN
  -- Check if stream exists and is not already archived
  SELECT name, status INTO v_stream_name, v_stream_status
  FROM public.streams
  WHERE id = p_stream_id;
  
  IF v_stream_name IS NULL THEN
    RAISE EXCEPTION 'Stream not found';
  END IF;
  
  IF v_stream_status = 'archived' THEN
    RAISE EXCEPTION 'Stream is already archived';
  END IF;
  
  -- Get statistics
  SELECT 
    COUNT(DISTINCT sc.class_id),
    COUNT(DISTINCT ce.legacy_student_id)
  INTO v_class_count, v_student_count
  FROM public.stream_classes sc
  LEFT JOIN public.class_enrollments ce ON sc.class_id = ce.class_id
  WHERE sc.stream_id = p_stream_id;
  
  -- Archive the stream
  UPDATE public.streams
  SET 
    status = 'archived',
    archived_at = now(),
    updated_at = now()
  WHERE id = p_stream_id;
  
  -- Return result
  RETURN jsonb_build_object(
    'stream_id', p_stream_id,
    'stream_name', v_stream_name,
    'archived_at', now(),
    'class_count', v_class_count,
    'student_count', v_student_count
  );
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION public.archive_stream(uuid) IS 'Manually archive a stream and return statistics';

-- ============================================================================
-- 6. FUNCTION FOR RESTORING FROM ARCHIVE
-- ============================================================================
-- Allow admins to restore a stream from archive
CREATE OR REPLACE FUNCTION public.restore_stream_from_archive(p_stream_id uuid)
RETURNS jsonb AS $$
DECLARE
  v_stream_name text;
  v_stream_status text;
BEGIN
  -- Check if stream exists and is archived
  SELECT name, status INTO v_stream_name, v_stream_status
  FROM public.streams
  WHERE id = p_stream_id;
  
  IF v_stream_name IS NULL THEN
    RAISE EXCEPTION 'Stream not found';
  END IF;
  
  IF v_stream_status != 'archived' THEN
    RAISE EXCEPTION 'Stream is not archived';
  END IF;
  
  -- Restore the stream to completed status
  UPDATE public.streams
  SET 
    status = 'completed',
    archived_at = NULL,
    updated_at = now()
  WHERE id = p_stream_id;
  
  -- Return result
  RETURN jsonb_build_object(
    'stream_id', p_stream_id,
    'stream_name', v_stream_name,
    'restored_at', now(),
    'new_status', 'completed'
  );
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION public.restore_stream_from_archive(uuid) IS 'Restore a stream from archive back to completed status (admin only)';

-- ============================================================================
-- 7. ROW LEVEL SECURITY (RLS) POLICIES
-- ============================================================================
-- Enable RLS on streams and archived views access

-- Ensure RLS is enabled on streams table
ALTER TABLE public.streams ENABLE ROW LEVEL SECURITY;

-- Policy: Anyone authenticated can view all streams (including archived)
DROP POLICY IF EXISTS streams_select_policy ON public.streams;
CREATE POLICY streams_select_policy ON public.streams
  FOR SELECT
  USING (true);

-- Policy: Only admins can archive streams (update to archived status)
DROP POLICY IF EXISTS streams_archive_policy ON public.streams;
CREATE POLICY streams_archive_policy ON public.streams
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE users.id = auth.uid()
      AND users.role = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE users.id = auth.uid()
      AND users.role = 'admin'
    )
  );

-- Policy: Admins and managers can insert/delete streams
DROP POLICY IF EXISTS streams_insert_policy ON public.streams;
CREATE POLICY streams_insert_policy ON public.streams
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE users.id = auth.uid()
      AND users.role IN ('admin', 'manager')
    )
  );

DROP POLICY IF EXISTS streams_delete_policy ON public.streams;
CREATE POLICY streams_delete_policy ON public.streams
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE users.id = auth.uid()
      AND users.role = 'admin'
    )
  );

COMMENT ON POLICY streams_select_policy ON public.streams IS 'All authenticated users can view streams';
COMMENT ON POLICY streams_archive_policy ON public.streams IS 'Only admins can archive/restore streams';
COMMENT ON POLICY streams_insert_policy ON public.streams IS 'Admins and managers can create streams';
COMMENT ON POLICY streams_delete_policy ON public.streams IS 'Only admins can delete streams';

-- ============================================================================
-- 8. HELPER FUNCTION TO GET ARCHIVE STATS
-- ============================================================================
-- Get comprehensive archive statistics
CREATE OR REPLACE FUNCTION public.get_archive_summary()
RETURNS jsonb AS $$
DECLARE
  v_result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'total_archived_streams', COUNT(*),
    'total_students_in_archive', SUM(total_students),
    'total_classes_in_archive', SUM(total_classes),
    'avg_attendance_overall', ROUND(AVG(avg_attendance_percentage)::numeric, 2),
    'avg_grade_overall', ROUND(AVG(avg_lesson_grade)::numeric, 2),
    'oldest_archived', MIN(archived_at),
    'newest_archived', MAX(archived_at)
  ) INTO v_result
  FROM public.archived_streams_stats;
  
  RETURN COALESCE(v_result, jsonb_build_object(
    'total_archived_streams', 0,
    'total_students_in_archive', 0,
    'total_classes_in_archive', 0,
    'avg_attendance_overall', 0,
    'avg_grade_overall', 0,
    'oldest_archived', null,
    'newest_archived', null
  ));
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION public.get_archive_summary() IS 'Get overall archive statistics across all archived streams';

-- ============================================================================
-- 9. TEACHER WORKLOAD ARCHIVE
-- ============================================================================

-- Table to store monthly teacher workload snapshots
CREATE TABLE IF NOT EXISTS public.teacher_workload_archive (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  teacher_id uuid NOT NULL REFERENCES public.users(id),
  stream_id uuid REFERENCES public.streams(id) ON DELETE SET NULL,
  year int NOT NULL,
  month int NOT NULL,
  total_lessons int DEFAULT 0,
  total_hours numeric(10, 2) DEFAULT 0,
  total_academic_hours numeric(10, 2) DEFAULT 0,
  archived_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now(),
  
  UNIQUE(teacher_id, stream_id, year, month)
);

CREATE INDEX IF NOT EXISTS idx_teacher_workload_archive_date ON public.teacher_workload_archive(year, month);
CREATE INDEX IF NOT EXISTS idx_teacher_workload_archive_teacher ON public.teacher_workload_archive(teacher_id);

COMMENT ON TABLE public.teacher_workload_archive IS 'Historical archive of teacher workload per month per stream';

-- Function to archive teacher workload for a specific month (or previous month by default)
CREATE OR REPLACE FUNCTION public.archive_teacher_workload_monthly(p_year int DEFAULT NULL, p_month int DEFAULT NULL)
RETURNS void AS $$
DECLARE
  v_start_date date;
  v_end_date date;
BEGIN
  -- If not provided, take previous month
  IF p_year IS NULL OR p_month IS NULL THEN
    p_year := EXTRACT(YEAR FROM (CURRENT_DATE - INTERVAL '1 month'));
    p_month := EXTRACT(MONTH FROM (CURRENT_DATE - INTERVAL '1 month'));
  END IF;
  
  v_start_date := make_date(p_year, p_month, 1);
  v_end_date := (v_start_date + INTERVAL '1 month') - INTERVAL '1 day';
  
  -- Insert or update workload stats
  INSERT INTO public.teacher_workload_archive (
    teacher_id,
    stream_id,
    year,
    month,
    total_lessons,
    total_hours,
    total_academic_hours,
    archived_at
  )
  SELECT 
    te.teacher_id,
    te.stream_id,
    p_year,
    p_month,
    COUNT(DISTINCT te.id),
    SUM(te.duration_minutes) / 60.0,
    SUM(te.duration_minutes) / 45.0,
    now()
  FROM public.timetable_entries te
  LEFT JOIN public.streams s ON te.stream_id = s.id
  WHERE 
    te.teacher_id IS NOT NULL 
    AND te.date >= v_start_date 
    AND te.date <= v_end_date
    AND (s.status IS NULL OR s.status != 'draft') -- Include active/completed/archived
  GROUP BY te.teacher_id, te.stream_id
  ON CONFLICT (teacher_id, stream_id, year, month) 
  DO UPDATE SET
    total_lessons = EXCLUDED.total_lessons,
    total_hours = EXCLUDED.total_hours,
    total_academic_hours = EXCLUDED.total_academic_hours,
    archived_at = now();

END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION public.archive_teacher_workload_monthly(int, int) IS 'Snapshots teacher workload for a specific month into the archive table';

-- Enable RLS
ALTER TABLE public.teacher_workload_archive ENABLE ROW LEVEL SECURITY;

CREATE POLICY teacher_workload_archive_view_policy ON public.teacher_workload_archive
  FOR SELECT
  USING (
    auth.uid() = teacher_id OR 
    EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role IN ('admin', 'manager'))
  );

-- Helper function to auto-run monthly archive (can be called by cron)
CREATE OR REPLACE FUNCTION public.auto_archive_teacher_workload()
RETURNS void AS $$
BEGIN
  -- Archives previous month data
  PERFORM public.archive_teacher_workload_monthly();
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- MIGRATION COMPLETE
-- ============================================================================
