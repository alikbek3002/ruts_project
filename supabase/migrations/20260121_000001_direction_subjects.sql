create table if not exists direction_subjects (
  id uuid default gen_random_uuid() primary key,
  direction_id uuid references directions(id) on delete cascade not null,
  subject_id uuid references subjects(id) on delete cascade not null,
  lecture_hours float default 0,
  seminar_hours float default 0,
  practical_hours float default 0,
  exam_hours float default 0,
  total_hours float default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(direction_id, subject_id)
);

alter table direction_subjects enable row level security;

create policy "Admins and managers can do everything on direction_subjects"
  on direction_subjects for all
  using (
    exists (
      select 1 from users
      where users.id = auth.uid()
      and users.role in ('admin', 'manager')
    )
  );

create policy "Public read access for direction_subjects"
  on direction_subjects for select
  using (true);
