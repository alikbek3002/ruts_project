-- Migration: subject_topics table (syllabus)
-- Created: 2026-01-19

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.subject_topics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_id uuid NOT NULL REFERENCES public.subjects(id) ON DELETE CASCADE,
  topic_number integer NOT NULL,
  topic_name text NOT NULL,
  lecture_hours numeric(10,2) NOT NULL DEFAULT 0,
  seminar_hours numeric(10,2) NOT NULL DEFAULT 0,
  practical_hours numeric(10,2) NOT NULL DEFAULT 0,
  exam_hours numeric(10,2) NOT NULL DEFAULT 0,
  description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(subject_id, topic_number)
);

CREATE INDEX IF NOT EXISTS idx_subject_topics_subject ON public.subject_topics(subject_id);
CREATE INDEX IF NOT EXISTS idx_subject_topics_subject_number ON public.subject_topics(subject_id, topic_number);

CREATE OR REPLACE FUNCTION public.update_subject_topics_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS subject_topics_updated_at_trigger ON public.subject_topics;
CREATE TRIGGER subject_topics_updated_at_trigger
  BEFORE UPDATE ON public.subject_topics
  FOR EACH ROW
  EXECUTE FUNCTION public.update_subject_topics_updated_at();
