-- Add audience to meeting_links

ALTER TABLE public.meeting_links
ADD COLUMN IF NOT EXISTS audience text CHECK (audience IN ('class', 'teachers', 'all'));

-- Add comment explaining usage
COMMENT ON COLUMN public.meeting_links.audience IS 'Target audience: class (students of specific class), teachers, or all';
