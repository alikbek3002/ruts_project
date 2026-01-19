
-- Update zoom_meetings to support custom meetings (not linked to timetable)
ALTER TABLE public.zoom_meetings ALTER COLUMN timetable_entry_id DROP NOT NULL;

DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'zoom_meetings' AND column_name = 'title') THEN
      ALTER TABLE public.zoom_meetings ADD COLUMN title text;
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'zoom_meetings' AND column_name = 'target_audience') THEN
      ALTER TABLE public.zoom_meetings ADD COLUMN target_audience text CHECK (target_audience IN ('teachers', 'students', 'class'));
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'zoom_meetings' AND column_name = 'class_id') THEN
      ALTER TABLE public.zoom_meetings ADD COLUMN class_id uuid REFERENCES public.classes(id);
  END IF;
END $$;

-- If existing rows don't have target_audience, imply it based on timetable
UPDATE public.zoom_meetings SET target_audience = 'class' WHERE target_audience IS NULL;
