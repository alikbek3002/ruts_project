-- Create a join table for allocating meetings to multiple classes
CREATE TABLE IF NOT EXISTS public.meeting_link_audiences (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    meeting_link_id uuid REFERENCES public.meeting_links(id) ON DELETE CASCADE,
    class_id uuid REFERENCES public.classes(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(meeting_link_id, class_id)
);

CREATE INDEX IF NOT EXISTS idx_meeting_link_audiences_link ON public.meeting_link_audiences(meeting_link_id);
CREATE INDEX IF NOT EXISTS idx_meeting_link_audiences_class ON public.meeting_link_audiences(class_id);

COMMENT ON TABLE public.meeting_link_audiences IS 'Links meetings to specific classes (many-to-many)';
