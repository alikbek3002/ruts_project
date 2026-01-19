-- Subject content system: materials, tests (quiz/document), attempts

-- Materials attached to subject topics
create table if not exists public.subject_topic_materials (
  id uuid primary key default gen_random_uuid(),
  subject_id uuid not null references public.subjects(id) on delete cascade,
  topic_id uuid not null references public.subject_topics(id) on delete cascade,
  kind text not null check (kind in ('file', 'link')),
  title text not null,
  url text null,
  storage_bucket text not null default 'library',
  storage_path text null,
  original_filename text null,
  uploaded_by uuid null references public.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_subject_topic_materials_topic_id_created_at
  on public.subject_topic_materials(topic_id, created_at);

-- Tests attached to subject topics
create table if not exists public.subject_tests (
  id uuid primary key default gen_random_uuid(),
  topic_id uuid not null references public.subject_topics(id) on delete cascade,
  title text not null,
  description text null,
  document_storage_path text null,
  document_original_filename text null,
  test_type text not null check (test_type in ('quiz', 'document')),
  time_limit_minutes integer null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_subject_tests_topic_id_created_at
  on public.subject_tests(topic_id, created_at);

-- Quiz questions
create table if not exists public.subject_test_questions (
  id uuid primary key default gen_random_uuid(),
  test_id uuid not null references public.subject_tests(id) on delete cascade,
  question_text text not null,
  order_index integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_subject_test_questions_test_id_order
  on public.subject_test_questions(test_id, order_index);

-- Answer options
create table if not exists public.subject_test_question_options (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null references public.subject_test_questions(id) on delete cascade,
  option_text text not null,
  is_correct boolean not null default false,
  order_index integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_subject_test_question_options_question_id_order
  on public.subject_test_question_options(question_id, order_index);

-- Topic reads ("прочитал")
create table if not exists public.subject_topic_reads (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.users(id) on delete cascade,
  topic_id uuid not null references public.subject_topics(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique(student_id, topic_id)
);

create index if not exists idx_subject_topic_reads_student_id
  on public.subject_topic_reads(student_id);

-- Attempts
create table if not exists public.subject_test_attempts (
  id uuid primary key default gen_random_uuid(),
  test_id uuid not null references public.subject_tests(id) on delete cascade,
  student_id uuid not null references public.users(id) on delete cascade,
  started_at timestamptz not null default now(),
  submitted_at timestamptz null,
  time_limit_seconds integer null,
  score integer null,
  total_questions integer null,
  percentage_score numeric null,
  created_at timestamptz not null default now()
);

create index if not exists idx_subject_test_attempts_student_test
  on public.subject_test_attempts(student_id, test_id);

create index if not exists idx_subject_test_attempts_submitted
  on public.subject_test_attempts(test_id, submitted_at);

-- Attempt answers
create table if not exists public.subject_test_attempt_answers (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references public.subject_test_attempts(id) on delete cascade,
  question_id uuid not null references public.subject_test_questions(id) on delete cascade,
  selected_option_id uuid null references public.subject_test_question_options(id) on delete set null,
  is_correct boolean null,
  created_at timestamptz not null default now()
);

create index if not exists idx_subject_test_attempt_answers_attempt_id
  on public.subject_test_attempt_answers(attempt_id);

-- Ask PostgREST to reload schema cache
select pg_notify('pgrst', 'reload schema');
