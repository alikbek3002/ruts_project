-- Migration: Subject Content (materials, reads, tests)
-- Created: 2026-01-19

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- =====================================================================
-- 1) Materials per subject topic
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.subject_topic_materials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_id uuid NOT NULL REFERENCES public.subjects(id) ON DELETE CASCADE,
  topic_id uuid NOT NULL REFERENCES public.subject_topics(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('file', 'link')),
  title text NOT NULL,
  url text,
  storage_bucket text NOT NULL DEFAULT 'library',
  storage_path text,
  original_filename text,
  uploaded_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT subject_topic_materials_kind_check CHECK (
    (kind = 'link' AND url IS NOT NULL AND storage_path IS NULL) OR
    (kind = 'file' AND storage_path IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_subject_topic_materials_topic ON public.subject_topic_materials(topic_id);
CREATE INDEX IF NOT EXISTS idx_subject_topic_materials_subject ON public.subject_topic_materials(subject_id);

-- =====================================================================
-- 2) "Read" confirmation per student per subject topic
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.subject_topic_reads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  topic_id uuid NOT NULL REFERENCES public.subject_topics(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(student_id, topic_id)
);

CREATE INDEX IF NOT EXISTS idx_subject_topic_reads_student ON public.subject_topic_reads(student_id);
CREATE INDEX IF NOT EXISTS idx_subject_topic_reads_topic ON public.subject_topic_reads(topic_id);

-- =====================================================================
-- 3) Tests per subject topic (quiz/document)
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.subject_tests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  topic_id uuid NOT NULL REFERENCES public.subject_topics(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  document_storage_path text,
  document_original_filename text,
  test_type text NOT NULL CHECK (test_type IN ('quiz', 'document')),
  time_limit_minutes integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT subject_tests_time_limit_check CHECK (
    (test_type = 'quiz' AND time_limit_minutes IS NOT NULL AND time_limit_minutes > 0) OR
    (test_type = 'document' AND time_limit_minutes IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_subject_tests_topic ON public.subject_tests(topic_id);
CREATE INDEX IF NOT EXISTS idx_subject_tests_type ON public.subject_tests(test_type);

CREATE TABLE IF NOT EXISTS public.subject_test_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  test_id uuid NOT NULL REFERENCES public.subject_tests(id) ON DELETE CASCADE,
  question_text text NOT NULL,
  order_index integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_subject_test_questions_test ON public.subject_test_questions(test_id);
CREATE INDEX IF NOT EXISTS idx_subject_test_questions_order ON public.subject_test_questions(test_id, order_index);

CREATE TABLE IF NOT EXISTS public.subject_test_question_options (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id uuid NOT NULL REFERENCES public.subject_test_questions(id) ON DELETE CASCADE,
  option_text text NOT NULL,
  is_correct boolean NOT NULL DEFAULT false,
  order_index integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_subject_test_question_options_question ON public.subject_test_question_options(question_id);
CREATE INDEX IF NOT EXISTS idx_subject_test_question_options_order ON public.subject_test_question_options(question_id, order_index);

CREATE TABLE IF NOT EXISTS public.subject_test_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  test_id uuid NOT NULL REFERENCES public.subject_tests(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  started_at timestamptz NOT NULL DEFAULT now(),
  submitted_at timestamptz,
  time_limit_seconds integer,
  score integer,
  total_questions integer,
  percentage_score numeric(5,2),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_subject_test_attempts_test ON public.subject_test_attempts(test_id);
CREATE INDEX IF NOT EXISTS idx_subject_test_attempts_student ON public.subject_test_attempts(student_id);
CREATE INDEX IF NOT EXISTS idx_subject_test_attempts_submitted ON public.subject_test_attempts(submitted_at DESC);

CREATE TABLE IF NOT EXISTS public.subject_test_attempt_answers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id uuid NOT NULL REFERENCES public.subject_test_attempts(id) ON DELETE CASCADE,
  question_id uuid NOT NULL REFERENCES public.subject_test_questions(id) ON DELETE CASCADE,
  selected_option_id uuid REFERENCES public.subject_test_question_options(id) ON DELETE SET NULL,
  is_correct boolean,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(attempt_id, question_id)
);

CREATE INDEX IF NOT EXISTS idx_subject_test_attempt_answers_attempt ON public.subject_test_attempt_answers(attempt_id);
CREATE INDEX IF NOT EXISTS idx_subject_test_attempt_answers_question ON public.subject_test_attempt_answers(question_id);

-- =====================================================================
-- 4) Triggers
-- =====================================================================
CREATE OR REPLACE FUNCTION public.update_subject_content_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS subject_tests_updated_at_trigger ON public.subject_tests;
CREATE TRIGGER subject_tests_updated_at_trigger
  BEFORE UPDATE ON public.subject_tests
  FOR EACH ROW
  EXECUTE FUNCTION public.update_subject_content_updated_at();

-- Enforce student role for attempts/reads (best-effort)
CREATE OR REPLACE FUNCTION public.enforce_student_role_for_subject_attempts()
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

DROP TRIGGER IF EXISTS subject_test_attempts_student_role_trigger ON public.subject_test_attempts;
CREATE TRIGGER subject_test_attempts_student_role_trigger
  BEFORE INSERT OR UPDATE OF student_id ON public.subject_test_attempts
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_student_role_for_subject_attempts();

DROP TRIGGER IF EXISTS subject_topic_reads_student_role_trigger ON public.subject_topic_reads;
CREATE TRIGGER subject_topic_reads_student_role_trigger
  BEFORE INSERT OR UPDATE OF student_id ON public.subject_topic_reads
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_student_role_for_subject_attempts();
