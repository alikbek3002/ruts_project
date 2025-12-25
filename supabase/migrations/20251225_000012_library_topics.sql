-- Library topics (themes) + grouping of library files

create table if not exists public.library_topics (
  id uuid primary key default gen_random_uuid(),
  class_id uuid null references public.classes(id) on delete set null,
  title text not null,
  description text null,
  created_by uuid not null references public.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create index if not exists idx_library_topics_class on public.library_topics(class_id);
create index if not exists idx_library_topics_created_by on public.library_topics(created_by);

alter table public.library_items
  add column if not exists topic_id uuid null references public.library_topics(id) on delete set null;

create index if not exists idx_library_items_topic on public.library_items(topic_id);
