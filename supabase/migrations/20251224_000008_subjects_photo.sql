-- Add optional photo for subjects
ALTER TABLE public.subjects
  ADD COLUMN IF NOT EXISTS photo_url text NULL;

CREATE INDEX IF NOT EXISTS idx_subjects_photo_url ON public.subjects(photo_url);
