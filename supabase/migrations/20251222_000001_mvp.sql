-- MVP schema for RUTS Journal

create extension if not exists pgcrypto;

-- USERS
create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  role text not null check (role in ('admin','teacher','student')),
  username text not null unique,
  full_name text not null,
  password_hash text not null,
  must_change_password boolean not null default true,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_users_role on public.users(role);

-- REFRESH TOKENS
create table if not exists public.refresh_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  revoked_at timestamptz null,
  created_at timestamptz not null default now()
);

create index if not exists idx_refresh_tokens_user_id on public.refresh_tokens(user_id);

-- CLASSES + ENROLLMENTS
create table if not exists public.classes (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create unique index if not exists uq_classes_name on public.classes(name);

create table if not exists public.class_enrollments (
  class_id uuid not null references public.classes(id) on delete cascade,
  student_id uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (class_id, student_id)
);

create index if not exists idx_class_enrollments_student_id on public.class_enrollments(student_id);

-- TIMETABLE (weekly)
create table if not exists public.timetable_entries (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes(id) on delete cascade,
  teacher_id uuid not null references public.users(id) on delete restrict,
  subject text not null,
  weekday smallint not null check (weekday >= 0 and weekday <= 6),
  start_time time not null,
  end_time time not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists idx_timetable_class on public.timetable_entries(class_id);
create index if not exists idx_timetable_teacher on public.timetable_entries(teacher_id);
create index if not exists idx_timetable_weekday on public.timetable_entries(weekday);

-- GRADEBOOK
create table if not exists public.assessments (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes(id) on delete cascade,
  title text not null,
  date date not null,
  created_by uuid not null references public.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create index if not exists idx_assessments_class on public.assessments(class_id);
create index if not exists idx_assessments_date on public.assessments(date);

create table if not exists public.grades (
  assessment_id uuid not null references public.assessments(id) on delete cascade,
  student_id uuid not null references public.users(id) on delete cascade,
  value smallint not null check (value >= 1 and value <= 5),
  comment text null,
  created_at timestamptz not null default now(),
  primary key (assessment_id, student_id)
);

create index if not exists idx_grades_student on public.grades(student_id);

-- LIBRARY
create table if not exists public.library_items (
  id uuid primary key default gen_random_uuid(),
  class_id uuid null references public.classes(id) on delete set null,
  title text not null,
  description text null,
  storage_bucket text not null default 'library',
  storage_path text not null,
  uploaded_by uuid not null references public.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create index if not exists idx_library_class on public.library_items(class_id);

-- ZOOM OAuth (teacher-level)
create table if not exists public.zoom_oauth_states (
  state text primary key,
  user_id uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.zoom_oauth_tokens (
  teacher_id uuid primary key references public.users(id) on delete cascade,
  zoom_user_id text null,
  access_token_enc text not null,
  refresh_token_enc text not null,
  expires_at timestamptz not null,
  scopes text null,
  updated_at timestamptz not null default now()
);

-- Meetings created from timetable occurrences
create table if not exists public.zoom_meetings (
  id uuid primary key default gen_random_uuid(),
  timetable_entry_id uuid not null references public.timetable_entries(id) on delete cascade,
  starts_at timestamptz not null,
  zoom_meeting_id text not null,
  join_url text not null,
  start_url text null,
  created_by uuid not null references public.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create index if not exists idx_zoom_meetings_timetable on public.zoom_meetings(timetable_entry_id);
create index if not exists idx_zoom_meetings_starts_at on public.zoom_meetings(starts_at);
