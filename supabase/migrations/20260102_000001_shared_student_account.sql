-- Migration: Shared Student Account
-- Created: 2026-01-02
-- Description: Create a single shared student account for all students to login

-- Create shared student user with known credentials
-- Login: student
-- Password: 123456 (hashed with bcrypt)

INSERT INTO public.users (
  id,
  role,
  username,
  full_name,
  first_name,
  last_name,
  phone,
  birth_date,
  password_hash,
  password_fingerprint,
  must_change_password,
  is_active,
  created_at,
  updated_at
) VALUES (
  'aaaaaaaa-bbbb-cccc-dddd-000000000001'::uuid,
  'student',
  'student',
  'Общий Студенческий Аккаунт',
  'Студент',
  'Общий',
  '+996000000000',
  '2000-01-01',
  '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewY5GyYzpUPBDc3i', -- bcrypt hash of '123456'
  'fp_shared_student_123456',
  false,
  true,
  now(),
  now()
)
ON CONFLICT (username) DO NOTHING;

-- Add comment to the shared student account
COMMENT ON TABLE public.users IS 'Users table. Student role uses shared account (username: student, password: 123456) for multiple concurrent sessions';
