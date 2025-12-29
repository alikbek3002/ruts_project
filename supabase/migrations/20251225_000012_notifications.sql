-- Notifications system: announcements and read tracking

CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  message text NOT NULL,
  type text NOT NULL CHECK (type IN ('info', 'success', 'warning', 'error', 'announcement')),
  target_role text NULL CHECK (target_role IN ('teacher', 'student', 'admin', 'manager', 'all')),
  target_user_id uuid NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_by uuid NOT NULL REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NULL,
  is_active boolean NOT NULL DEFAULT true
);

COMMENT ON TABLE public.notifications IS 'System notifications and announcements';

CREATE TABLE IF NOT EXISTS public.user_notification_reads (
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  notification_id uuid NOT NULL REFERENCES public.notifications(id) ON DELETE CASCADE,
  read_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, notification_id)
);

COMMENT ON TABLE public.user_notification_reads IS 'Tracks which users have read which notifications';

-- Indexes (some are created in 20251226_000013_add_indexes.sql; keep idempotent here)
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON public.notifications (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_target_role ON public.notifications (target_role) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_notifications_target_user ON public.notifications (target_user_id) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_user_notification_reads_user ON public.user_notification_reads (user_id);
