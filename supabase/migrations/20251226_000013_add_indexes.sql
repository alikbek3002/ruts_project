-- Add indexes to speed up common filters and joins

-- Index for notifications queries (is_active, created_at)
CREATE INDEX IF NOT EXISTS idx_notifications_active_created_at ON public.notifications (is_active, created_at DESC);

-- Index for notifications by target role and target user
CREATE INDEX IF NOT EXISTS idx_notifications_target_role ON public.notifications (target_role);
CREATE INDEX IF NOT EXISTS idx_notifications_target_user_id ON public.notifications (target_user_id);

-- Index for lesson_journal lookups by timetable_entry_id and lesson_date
CREATE INDEX IF NOT EXISTS idx_lesson_journal_entry_date ON public.lesson_journal (timetable_entry_id, lesson_date);

-- Indexes for timetable queries
CREATE INDEX IF NOT EXISTS idx_timetable_entries_class_id ON public.timetable_entries (class_id);
CREATE INDEX IF NOT EXISTS idx_timetable_entries_teacher_id ON public.timetable_entries (teacher_id);
CREATE INDEX IF NOT EXISTS idx_timetable_entries_weekday_start ON public.timetable_entries (weekday, start_time);

-- Index for user_notification_reads lookup
CREATE INDEX IF NOT EXISTS idx_user_notification_reads_user_id_notification_id ON public.user_notification_reads (user_id, notification_id);