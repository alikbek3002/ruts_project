-- Migration: Courses System with Tests
-- Created: 2025-01-01
-- Description: Add courses, topics, tests with questions and results

-- ============================================================================
-- 1. COURSES TABLE
-- ============================================================================
-- Courses created by teachers
CREATE TABLE IF NOT EXISTS public.courses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  description text,
  teacher_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT courses_teacher_check CHECK (
    (SELECT role FROM public.users WHERE id = teacher_id) = 'teacher'
  )
);

CREATE INDEX idx_courses_teacher ON public.courses(teacher_id);
CREATE INDEX idx_courses_created_at ON public.courses(created_at DESC);

COMMENT ON TABLE public.courses IS 'Courses created by teachers, visible to all students and admins';

-- ============================================================================
-- 2. COURSE TOPICS TABLE
-- ============================================================================
-- Topics within courses (can contain presentations, descriptions, tests)
CREATE TABLE IF NOT EXISTS public.course_topics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id uuid NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  presentation_storage_path text, -- Path to presentation file in Supabase Storage
  presentation_original_filename text,
  order_index integer NOT NULL DEFAULT 0, -- For ordering topics within course
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_course_topics_course ON public.course_topics(course_id);
CREATE INDEX idx_course_topics_order ON public.course_topics(course_id, order_index);

COMMENT ON TABLE public.course_topics IS 'Topics within courses, can contain presentations, descriptions, and tests';

-- ============================================================================
-- 3. COURSE TESTS TABLE
-- ============================================================================
-- Tests within course topics
CREATE TABLE IF NOT EXISTS public.course_tests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  topic_id uuid NOT NULL REFERENCES public.course_topics(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text, -- For type 'document' tests
  document_storage_path text, -- For type 'document' tests
  document_original_filename text, -- For type 'document' tests
  test_type text NOT NULL CHECK (test_type IN ('quiz', 'document')),
  time_limit_minutes integer, -- For quiz type: time limit in minutes (NULL = no limit)
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT quiz_requires_time_limit CHECK (
    (test_type = 'quiz' AND time_limit_minutes IS NOT NULL AND time_limit_minutes > 0) OR
    (test_type = 'document')
  )
);

CREATE INDEX idx_course_tests_topic ON public.course_tests(topic_id);
CREATE INDEX idx_course_tests_type ON public.course_tests(test_type);

COMMENT ON TABLE public.course_tests IS 'Tests within course topics: quiz (with questions) or document (homework-like)';
COMMENT ON COLUMN public.course_tests.test_type IS 'quiz: question-based test, document: document/text homework';

-- ============================================================================
-- 4. TEST QUESTIONS TABLE
-- ============================================================================
-- Questions for quiz-type tests
CREATE TABLE IF NOT EXISTS public.test_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  test_id uuid NOT NULL REFERENCES public.course_tests(id) ON DELETE CASCADE,
  question_text text NOT NULL,
  order_index integer NOT NULL DEFAULT 0, -- For ordering questions within test
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_test_questions_test ON public.test_questions(test_id);
CREATE INDEX idx_test_questions_order ON public.test_questions(test_id, order_index);

COMMENT ON TABLE public.test_questions IS 'Questions for quiz-type tests';

-- ============================================================================
-- 5. TEST QUESTION OPTIONS TABLE
-- ============================================================================
-- Answer options for quiz questions
CREATE TABLE IF NOT EXISTS public.test_question_options (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id uuid NOT NULL REFERENCES public.test_questions(id) ON DELETE CASCADE,
  option_text text NOT NULL,
  is_correct boolean NOT NULL DEFAULT false,
  order_index integer NOT NULL DEFAULT 0, -- For ordering options within question
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_test_question_options_question ON public.test_question_options(question_id);
CREATE INDEX idx_test_question_options_order ON public.test_question_options(question_id, order_index);

COMMENT ON TABLE public.test_question_options IS 'Answer options for quiz questions, one should be marked as correct';

-- ============================================================================
-- 6. TEST ATTEMPTS TABLE
-- ============================================================================
-- Student attempts to take tests
CREATE TABLE IF NOT EXISTS public.test_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  test_id uuid NOT NULL REFERENCES public.course_tests(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  started_at timestamptz NOT NULL DEFAULT now(),
  submitted_at timestamptz, -- NULL if not yet submitted
  time_limit_seconds integer, -- Time limit in seconds (copied from test at start)
  score integer, -- For quiz: number of correct answers
  total_questions integer, -- For quiz: total number of questions
  percentage_score numeric(5,2), -- Percentage score (0-100)
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT test_attempts_student_check CHECK (
    (SELECT role FROM public.users WHERE id = student_id) = 'student'
  )
);

CREATE INDEX idx_test_attempts_test ON public.test_attempts(test_id);
CREATE INDEX idx_test_attempts_student ON public.test_attempts(student_id);
CREATE INDEX idx_test_attempts_submitted ON public.test_attempts(submitted_at DESC);

COMMENT ON TABLE public.test_attempts IS 'Student attempts to take tests, tracks timing and scores';

-- ============================================================================
-- 7. TEST ATTEMPT ANSWERS TABLE
-- ============================================================================
-- Student answers to quiz questions
CREATE TABLE IF NOT EXISTS public.test_attempt_answers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id uuid NOT NULL REFERENCES public.test_attempts(id) ON DELETE CASCADE,
  question_id uuid NOT NULL REFERENCES public.test_questions(id) ON DELETE CASCADE,
  selected_option_id uuid REFERENCES public.test_question_options(id) ON DELETE SET NULL,
  is_correct boolean, -- Whether the selected answer was correct
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(attempt_id, question_id)
);

CREATE INDEX idx_test_attempt_answers_attempt ON public.test_attempt_answers(attempt_id);
CREATE INDEX idx_test_attempt_answers_question ON public.test_attempt_answers(question_id);

COMMENT ON TABLE public.test_attempt_answers IS 'Student answers to quiz questions, stores selected option and correctness';

-- ============================================================================
-- 8. TRIGGERS FOR UPDATED_AT
-- ============================================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_courses_updated_at BEFORE UPDATE ON public.courses
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_course_topics_updated_at BEFORE UPDATE ON public.course_topics
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_course_tests_updated_at BEFORE UPDATE ON public.course_tests
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- MIGRATION COMPLETE
-- ============================================================================

