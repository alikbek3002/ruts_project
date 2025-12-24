-- Lesson journal: grades + attendance per timetable lesson occurrence

create table if not exists public.lesson_journal (
  timetable_entry_id uuid not null references public.timetable_entries(id) on delete cascade,
  lesson_date date not null,
  student_id uuid not null references public.users(id) on delete cascade,
  present boolean null,
  grade smallint null check (grade is null or (grade >= 1 and grade <= 5)),
  comment text null,
  created_by uuid not null references public.users(id) on delete restrict,
  updated_at timestamptz not null default now(),
  primary key (timetable_entry_id, lesson_date, student_id)
);

create index if not exists idx_lesson_journal_student on public.lesson_journal(student_id);
create index if not exists idx_lesson_journal_date on public.lesson_journal(lesson_date);
create index if not exists idx_lesson_journal_timetable on public.lesson_journal(timetable_entry_id);
