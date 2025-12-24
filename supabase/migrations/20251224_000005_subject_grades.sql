-- Subject grades: оценки учеников по предметам

create table if not exists public.subject_grades (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes(id) on delete cascade,
  student_id uuid not null references public.users(id) on delete cascade,
  subject text not null,
  grade smallint not null check (grade >= 1 and grade <= 5),
  comment text null,
  created_by uuid not null references public.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_subject_grades_class on public.subject_grades(class_id);
create index if not exists idx_subject_grades_student on public.subject_grades(student_id);
create index if not exists idx_subject_grades_subject on public.subject_grades(subject);

-- Note: RLS is disabled because we use custom JWT auth, not Supabase Auth
-- API uses service_role key which bypasses RLS anyway
