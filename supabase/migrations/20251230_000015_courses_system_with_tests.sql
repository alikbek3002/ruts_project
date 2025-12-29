-- Migration: Courses System with Tests
-- Created: 2025-12-30
-- Description: Add courses, topics, tests (quiz/document), questions, options, attempts, answers

-- Notes:
-- - Postgres CHECK constraints cannot reference other tables, so role validation is enforced via triggers.

-- ==========================================================================
-- 0. EXTENSIONS (safe on Supabase)
-- ==========================================================================
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ==========================================================================
-- 1. COURSES TABLE
-- ==========================================================================
CREATE TABLE IF NOT EXISTS public.courses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  description text,
  teacher_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_courses_teacher ON public.courses(teacher_id);
CREATE INDEX IF NOT EXISTS idx_courses_created_at ON public.courses(created_at DESC);

COMMENT ON TABLE public.courses IS 'Courses created by teachers, visible to all students and admins';

-- ==========================================================================
-- 2. COURSE TOPICS TABLE
-- ==========================================================================
CREATE TABLE IF NOT EXISTS public.course_topics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id uuid NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  presentation_storage_path text,
  presentation_original_filename text,
  order_index integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_course_topics_course ON public.course_topics(course_id);
CREATE INDEX IF NOT EXISTS idx_course_topics_order ON public.course_topics(course_id, order_index);

COMMENT ON TABLE public.course_topics IS 'Topics within courses, can contain presentations, descriptions, and tests';

-- ==========================================================================
-- 3. COURSE TESTS TABLE
-- ==========================================================================
CREATE TABLE IF NOT EXISTS public.course_tests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  topic_id uuid NOT NULL REFERENCES public.course_topics(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  document_storage_path text,
  document_original_filename text,
  test_type text NOT NULL CHECK (test_type IN ('quiz', 'document')),
  time_limit_minutes integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT course_tests_time_limit_check CHECK (
    (test_type = 'quiz' AND time_limit_minutes IS NOT NULL AND time_limit_minutes > 0) OR
    (test_type = 'document' AND time_limit_minutes IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_course_tests_topic ON public.course_tests(topic_id);
CREATE INDEX IF NOT EXISTS idx_course_tests_type ON public.course_tests(test_type);

COMMENT ON TABLE public.course_tests IS 'Tests within course topics: quiz (with questions) or document (homework-like)';
COMMENT ON COLUMN public.course_tests.test_type IS 'quiz: question-based test, document: document/text homework';

-- ==========================================================================
-- 4. TEST QUESTIONS TABLE
-- ==========================================================================
CREATE TABLE IF NOT EXISTS public.test_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  test_id uuid NOT NULL REFERENCES public.course_tests(id) ON DELETE CASCADE,
  question_text text NOT NULL,
  order_index integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_test_questions_test ON public.test_questions(test_id);
CREATE INDEX IF NOT EXISTS idx_test_questions_order ON public.test_questions(test_id, order_index);

COMMENT ON TABLE public.test_questions IS 'Questions for quiz-type tests';

-- ==========================================================================
-- 5. TEST QUESTION OPTIONS TABLE
-- ==========================================================================
CREATE TABLE IF NOT EXISTS public.test_question_options (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id uuid NOT NULL REFERENCES public.test_questions(id) ON DELETE CASCADE,
  option_text text NOT NULL,
  is_correct boolean NOT NULL DEFAULT false,
  order_index integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_test_question_options_question ON public.test_question_options(question_id);
CREATE INDEX IF NOT EXISTS idx_test_question_options_order ON public.test_question_options(question_id, order_index);

COMMENT ON TABLE public.test_question_options IS 'Answer options for quiz questions';

-- ==========================================================================
-- 6. TEST ATTEMPTS TABLE
-- ==========================================================================
CREATE TABLE IF NOT EXISTS public.test_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  test_id uuid NOT NULL REFERENCES public.course_tests(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  started_at timestamptz NOT NULL DEFAULT now(),
  submitted_at timestamptz,
  time_limit_seconds integer,
  score integer,
  total_questions integer,
  percentage_score numeric(5,2),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_test_attempts_test ON public.test_attempts(test_id);
CREATE INDEX IF NOT EXISTS idx_test_attempts_student ON public.test_attempts(student_id);
CREATE INDEX IF NOT EXISTS idx_test_attempts_submitted ON public.test_attempts(submitted_at DESC);

COMMENT ON TABLE public.test_attempts IS 'Student attempts to take tests, tracks timing and scores';

-- ==========================================================================
-- 7. TEST ATTEMPT ANSWERS TABLE
-- ==========================================================================
CREATE TABLE IF NOT EXISTS public.test_attempt_answers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id uuid NOT NULL REFERENCES public.test_attempts(id) ON DELETE CASCADE,
  question_id uuid NOT NULL REFERENCES public.test_questions(id) ON DELETE CASCADE,
  selected_option_id uuid REFERENCES public.test_question_options(id) ON DELETE SET NULL,
  is_correct boolean,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(attempt_id, question_id)
);

CREATE INDEX IF NOT EXISTS idx_test_attempt_answers_attempt ON public.test_attempt_answers(attempt_id);
CREATE INDEX IF NOT EXISTS idx_test_attempt_answers_question ON public.test_attempt_answers(question_id);

COMMENT ON TABLE public.test_attempt_answers IS 'Student answers to quiz questions, stores selected option and correctness';

-- ==========================================================================
-- 8. UPDATED_AT TRIGGERS
-- ==========================================================================
CREATE OR REPLACE FUNCTION public.update_courses_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS courses_updated_at_trigger ON public.courses;
CREATE TRIGGER courses_updated_at_trigger
  BEFORE UPDATE ON public.courses
  FOR EACH ROW
  EXECUTE FUNCTION public.update_courses_updated_at();

DROP TRIGGER IF EXISTS course_topics_updated_at_trigger ON public.course_topics;
CREATE TRIGGER course_topics_updated_at_trigger
  BEFORE UPDATE ON public.course_topics
  FOR EACH ROW
  EXECUTE FUNCTION public.update_courses_updated_at();

DROP TRIGGER IF EXISTS course_tests_updated_at_trigger ON public.course_tests;
CREATE TRIGGER course_tests_updated_at_trigger
  BEFORE UPDATE ON public.course_tests
  FOR EACH ROW
  EXECUTE FUNCTION public.update_courses_updated_at();

-- ==========================================================================
-- 9. ROLE VALIDATION TRIGGERS (instead of CHECK with subquery)
-- ==========================================================================
CREATE OR REPLACE FUNCTION public.enforce_courses_teacher_role()
RETURNS TRIGGER AS $$
DECLARE
  user_role text;
BEGIN
  SELECT role INTO user_role FROM public.users WHERE id = NEW.teacher_id;
  IF user_role IS DISTINCT FROM 'teacher' THEN
    RAISE EXCEPTION 'teacher_id must refer to a user with role=teacher';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS courses_teacher_role_trigger ON public.courses;
CREATE TRIGGER courses_teacher_role_trigger
  BEFORE INSERT OR UPDATE OF teacher_id ON public.courses
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_courses_teacher_role();

CREATE OR REPLACE FUNCTION public.enforce_test_attempts_student_role()
RETURNS TRIGGER AS $$
DECLARE
  user_role text;
BEGIN
  SELECT role INTO user_role FROM public.users WHERE id = NEW.student_id;
  IF user_role IS DISTINCT FROM 'student' THEN
    RAISE EXCEPTION 'student_id must refer to a user with role=student';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS test_attempts_student_role_trigger ON public.test_attempts;
CREATE TRIGGER test_attempts_student_role_trigger
  BEFORE INSERT OR UPDATE OF student_id ON public.test_attempts
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_test_attempts_student_role();

-- ==========================================================================
-- MIGRATION COMPLETE
-- ==========================================================================
