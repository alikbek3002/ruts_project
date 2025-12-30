alter table public.course_topics
add column if not exists links jsonb default '[]'::jsonb;
