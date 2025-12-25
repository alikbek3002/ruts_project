alter table public.library_topics
  add column if not exists subject_id uuid null references public.subjects(id) on delete set null;

create index if not exists idx_library_topics_subject on public.library_topics(subject_id);
